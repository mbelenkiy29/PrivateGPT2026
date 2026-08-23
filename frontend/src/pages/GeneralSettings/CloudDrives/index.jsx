import { useEffect, useState } from "react";
import Sidebar from "@/components/SettingsSidebar";
import { isMobile } from "react-device-detect";
import FileSources from "@/models/fileSources";
import showToast from "@/utils/toast";
import Button from "@/components/ui/21st/Button";
import Field from "@/components/ui/21st/Field";
import Card from "@/components/ui/21st/Card";

export default function CloudDrivesSettings() {
  const [config, setConfig] = useState({
    onedrive: { clientId: "", clientSecret: "", configured: false },
    google: { clientId: "", clientSecret: "", configured: false },
  });
  const [saving, setSaving] = useState(false);
  const [watches, setWatches] = useState([]);

  useEffect(() => {
    FileSources.getOAuthConfig().then((res) => {
      if (res?.config) setConfig(res.config);
    });
    FileSources.list().then((res) => {
      setWatches(res?.knowledgeSources || []);
    });
  }, []);

  const update = (provider, field, value) => {
    setConfig((prev) => ({
      ...prev,
      [provider]: { ...prev[provider], [field]: value },
    }));
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    const result = await FileSources.saveOAuthConfig({
      onedrive: {
        clientId: config.onedrive.clientId,
        clientSecret: config.onedrive.clientSecret,
      },
      google: {
        clientId: config.google.clientId,
        clientSecret: config.google.clientSecret,
      },
    });
    setSaving(false);
    if (!result.success)
      return showToast(result.error || "Could not save.", "error");
    if (result.config) setConfig(result.config);
    showToast("Cloud drive credentials saved.", "success");
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
              Cloud drives
            </p>
            <p className="text-xs leading-[18px] text-theme-text-secondary">
              Connect OneDrive, SharePoint, Teams channel files, and Google
              Drive so you can browse company files in Manage Documents and
              index them into a workspace.
            </p>
          </div>

          <form
            className="flex flex-col gap-y-6 mt-6 max-w-[640px]"
            onSubmit={save}
          >
            <Card
              title="OneDrive / Microsoft"
              description={
                <>
                  Azure app registration used for OneDrive, SharePoint
                  libraries, and Teams channel files. Redirect URIs:{" "}
                  <code className="text-theme-text-primary">
                    http://localhost:3002/api/file-sources/onedrive/callback
                  </code>
                  {", "}
                  <code className="text-theme-text-primary">
                    /api/file-sources/sharepoint/callback
                  </code>
                  {", "}
                  <code className="text-theme-text-primary">
                    /api/file-sources/teams-files/callback
                  </code>
                  . Graph consent (Sites.Read.All, Team.ReadBasic.All,
                  Channel.ReadBasic.All, Files.Read.All) indexes files. A Teams
                  bot is a separate consent and is not required for file ingest.
                </>
              }
            >
              <Field
                label="Client ID"
                value={config.onedrive.clientId}
                onChange={(e) => update("onedrive", "clientId", e.target.value)}
                autoComplete="off"
              />
              <Field
                label="Client secret"
                type="password"
                value={config.onedrive.clientSecret}
                onChange={(e) =>
                  update("onedrive", "clientSecret", e.target.value)
                }
                autoComplete="off"
              />
            </Card>

            <Card
              title="Google Drive"
              description={
                <>
                  Google Cloud OAuth client. Redirect URI:{" "}
                  <code className="text-theme-text-primary">
                    http://localhost:3002/api/file-sources/google-drive/callback
                  </code>
                </>
              }
            >
              <Field
                label="Client ID"
                value={config.google.clientId}
                onChange={(e) => update("google", "clientId", e.target.value)}
                autoComplete="off"
              />
              <Field
                label="Client secret"
                type="password"
                value={config.google.clientSecret}
                onChange={(e) =>
                  update("google", "clientSecret", e.target.value)
                }
                autoComplete="off"
              />
            </Card>

            <Button
              type="submit"
              disabled={saving}
              loading={saving}
              className="w-fit"
            >
              {saving ? "Saving…" : "Save credentials"}
            </Button>
          </form>

          {watches.length > 0 && (
            <div className="flex flex-col gap-y-3 mt-10 max-w-[640px]">
              <p className="text-sm font-semibold text-theme-text-primary">
                Folder watches
              </p>
              <p className="text-xs text-theme-text-secondary">
                Folders indexed from Manage Documents are watched hourly for
                changes.
              </p>
              {watches.map((watch) => (
                <Card
                  key={watch.id}
                  title={watch.displayName || watch.remoteId || "Folder"}
                  description={
                    {
                      "google-drive": "Google Drive",
                      onedrive: "OneDrive",
                      sharepoint: "SharePoint",
                      "teams-files": "Teams files",
                    }[watch.provider] || watch.provider
                  }
                >
                  {watch.lastError ? (
                    <p className="text-[11px] text-red-400 break-words">
                      {watch.watchEnabled ? "Sync error" : "Watch paused"}:{" "}
                      {watch.lastError}
                    </p>
                  ) : watch.lastSyncedAt ? (
                    <p className="text-[11px] text-theme-text-secondary">
                      Last synced{" "}
                      {new Date(watch.lastSyncedAt).toLocaleString()}
                    </p>
                  ) : (
                    <p className="text-[11px] text-theme-text-secondary">
                      Waiting for first sync
                    </p>
                  )}
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
