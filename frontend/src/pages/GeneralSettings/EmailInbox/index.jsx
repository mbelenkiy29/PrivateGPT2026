import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Sidebar from "@/components/SettingsSidebar";
import { isMobile } from "react-device-detect";
import EmailInbox from "@/models/emailInbox";
import showToast from "@/utils/toast";
import Button from "@/components/ui/21st/Button";
import Field from "@/components/ui/21st/Field";
import Card from "@/components/ui/21st/Card";
import paths from "@/utils/paths";

const emptyImap = {
  display_name: "",
  workspaceId: "",
  host: "",
  port: "993",
  user: "",
  password: "",
  tls: true,
  includeSent: false,
};

export default function EmailInboxSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sources, setSources] = useState([]);
  const [workspaces, setWorkspaces] = useState([]);
  const [gmail, setGmail] = useState({ connected: false });
  const [outlook, setOutlook] = useState({ connected: false });
  const [imap, setImap] = useState(emptyImap);
  const [oauthWorkspaceId, setOauthWorkspaceId] = useState("");
  const [includeSent, setIncludeSent] = useState(false);

  const load = async () => {
    const res = await EmailInbox.status();
    setSources(res.sources || []);
    setWorkspaces(res.workspaces || []);
    setGmail(res.gmail || { connected: false });
    setOutlook(res.outlook || { connected: false });
    setImap((prev) => ({
      ...prev,
      workspaceId: prev.workspaceId || String(res.workspaces?.[0]?.id || ""),
    }));
    setOauthWorkspaceId(
      (current) => current || String(res.workspaces?.[0]?.id || "")
    );
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const updateImap = (field, value) => {
    setImap((prev) => ({ ...prev, [field]: value }));
  };

  const saveImap = async (e) => {
    e.preventDefault();
    if (!imap.workspaceId)
      return showToast("Pick a workspace to bind this inbox to.", "error");
    setSaving(true);
    const result = await EmailInbox.saveImap({
      ...imap,
      workspaceId: Number(imap.workspaceId),
      port: Number(imap.port || 993),
    });
    setSaving(false);
    if (!result.success)
      return showToast(
        result.error || "Could not save IMAP settings.",
        "error"
      );
    showToast("IMAP inbox added as a watched knowledge source.", "success");
    setImap((prev) => ({ ...emptyImap, workspaceId: prev.workspaceId }));
    load();
  };

  const connectProvider = async (provider) => {
    if (!oauthWorkspaceId)
      return showToast("Pick a workspace to bind this inbox to.", "error");
    setSaving(true);
    const fn =
      provider === "gmail-mail" ? EmailInbox.useGmail : EmailInbox.useOutlook;
    const result = await fn({
      workspaceId: Number(oauthWorkspaceId),
      includeSent,
    });
    setSaving(false);
    if (!result.success)
      return showToast(
        result.error || "Could not create knowledge source.",
        "error"
      );
    showToast("Inbox watch created.", "success");
    load();
  };

  const remove = async (id) => {
    const result = await EmailInbox.remove(id);
    if (!result.success)
      return showToast(result.error || "Could not remove source.", "error");
    showToast("Email knowledge source removed.", "success");
    load();
  };

  return (
    <div className="w-screen h-screen overflow-hidden bg-theme-bg-container flex">
      <Sidebar />
      <div
        style={{ height: isMobile ? "100%" : "calc(100% - 32px)" }}
        className="relative md:ml-[2px] md:mr-[16px] md:my-[16px] md:rounded-[16px] bg-theme-bg-secondary w-full h-full overflow-y-scroll p-4 md:p-0"
      >
        <div className="flex flex-col w-full px-1 md:pl-6 md:pr-[86px] md:py-6 py-16">
          <div className="w-full flex flex-col gap-y-1 pb-6 border-white/10 light:border-theme-sidebar-border border-b-2">
            <p className="text-lg leading-6 font-bold text-theme-text-primary">
              Email inbox
            </p>
            <p className="text-xs leading-[18px] text-theme-text-secondary">
              Ingest IMAP, Gmail, or Outlook mail as watched workspace
              knowledge. Spam and trash are skipped. Attachments are noted, not
              indexed.
            </p>
          </div>

          {loading ? (
            <p className="text-xs text-theme-text-secondary mt-6">Loading…</p>
          ) : (
            <div className="flex flex-col gap-y-6 mt-6 max-w-[640px]">
              <Card
                title="IMAP"
                description="Host, username, and app password are stored encrypted. Default folder is INBOX."
              >
                <form className="flex flex-col gap-y-3" onSubmit={saveImap}>
                  <WorkspaceSelect
                    workspaces={workspaces}
                    value={imap.workspaceId}
                    onChange={(value) => updateImap("workspaceId", value)}
                  />
                  <Field
                    label="Display name"
                    value={imap.display_name}
                    onChange={(e) => updateImap("display_name", e.target.value)}
                    placeholder="Support inbox"
                  />
                  <Field
                    label="Host"
                    value={imap.host}
                    onChange={(e) => updateImap("host", e.target.value)}
                    placeholder="imap.example.com"
                    autoComplete="off"
                  />
                  <Field
                    label="Port"
                    value={imap.port}
                    onChange={(e) => updateImap("port", e.target.value)}
                    autoComplete="off"
                  />
                  <Field
                    label="Username"
                    value={imap.user}
                    onChange={(e) => updateImap("user", e.target.value)}
                    autoComplete="off"
                  />
                  <Field
                    label="Password / app password"
                    type="password"
                    value={imap.password}
                    onChange={(e) => updateImap("password", e.target.value)}
                    autoComplete="off"
                    hint="Connections always use TLS (typically port 993). Plaintext LOGIN is not allowed."
                  />
                  <label className="flex items-center gap-2 text-xs text-theme-text-secondary">
                    <input
                      type="checkbox"
                      checked={imap.includeSent}
                      onChange={(e) =>
                        updateImap("includeSent", e.target.checked)
                      }
                    />
                    Also ingest Sent
                  </label>
                  <Button
                    type="submit"
                    disabled={saving}
                    loading={saving}
                    className="w-fit"
                  >
                    {saving ? "Saving…" : "Save IMAP and watch"}
                  </Button>
                </form>
              </Card>

              <Card
                title="Connected Gmail / Outlook"
                description="Reuse the Agent Skills connection if it is already configured. No send or draft APIs are added here."
              >
                <WorkspaceSelect
                  workspaces={workspaces}
                  value={oauthWorkspaceId}
                  onChange={setOauthWorkspaceId}
                />
                <label className="flex items-center gap-2 text-xs text-theme-text-secondary">
                  <input
                    type="checkbox"
                    checked={includeSent}
                    onChange={(e) => setIncludeSent(e.target.checked)}
                  />
                  Also ingest Sent
                </label>
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-theme-text-secondary">
                    Gmail: {gmail.connected ? "connected" : "not connected"}
                    {!gmail.connected && (
                      <>
                        {" "}
                        — configure it in{" "}
                        <Link
                          to={paths.settings.agentSkills()}
                          className="underline"
                        >
                          Agent Skills
                        </Link>
                        .
                      </>
                    )}
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={saving || !gmail.connected}
                    onClick={() => connectProvider("gmail-mail")}
                    className="w-fit"
                  >
                    Use connected Gmail
                  </Button>
                </div>
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-theme-text-secondary">
                    Outlook: {outlook.connected ? "connected" : "not connected"}
                    {!outlook.connected && (
                      <>
                        {" "}
                        — configure it in{" "}
                        <Link
                          to={paths.settings.agentSkills()}
                          className="underline"
                        >
                          Agent Skills
                        </Link>
                        .
                      </>
                    )}
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={saving || !outlook.connected}
                    onClick={() => connectProvider("outlook-mail")}
                    className="w-fit"
                  >
                    Use connected Outlook
                  </Button>
                </div>
              </Card>

              <Card title="Watched inboxes">
                {sources.length === 0 ? (
                  <p className="text-xs text-theme-text-secondary">
                    No email knowledge sources yet.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {sources.map((source) => (
                      <li
                        key={source.id}
                        className="flex items-center justify-between gap-3 text-xs text-theme-text-primary"
                      >
                        <span>
                          {source.display_name}{" "}
                          <span className="text-theme-text-secondary">
                            ({source.provider}
                            {source.last_synced_at
                              ? ` · last synced ${new Date(source.last_synced_at).toLocaleString()}`
                              : " · not synced yet"}
                            )
                          </span>
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => remove(source.id)}
                        >
                          Remove
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function WorkspaceSelect({ workspaces, value, onChange }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-theme-text-secondary">
        Workspace
      </span>
      <select
        className="flex h-9 w-full rounded-lg border border-theme-modal-border bg-theme-settings-input-bg px-3 py-2 text-sm text-theme-text-primary"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select a workspace</option>
        {workspaces.map((ws) => (
          <option key={ws.id} value={ws.id}>
            {ws.name}
          </option>
        ))}
      </select>
    </label>
  );
}
