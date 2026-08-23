import { useEffect, useState } from "react";
import Sidebar from "@/components/SettingsSidebar";
import { isMobile } from "react-device-detect";
import KnowledgeSources from "@/models/knowledgeSources";
import showToast from "@/utils/toast";
import Button from "@/components/ui/21st/Button";
import Field from "@/components/ui/21st/Field";
import Card from "@/components/ui/21st/Card";

const emptyDropbox = {
  clientId: "",
  clientSecret: "",
  configured: false,
  connected: false,
  accountEmail: null,
};

export default function KnowledgeSourcesSettings() {
  const [notionConnected, setNotionConnected] = useState(false);
  const [notionToken, setNotionToken] = useState("");
  const [dropbox, setDropbox] = useState(emptyDropbox);
  const [sources, setSources] = useState([]);
  const [workspaces, setWorkspaces] = useState([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [pages, setPages] = useState([]);
  const [selectedPage, setSelectedPage] = useState(null);
  const [folderPath, setFolderPath] = useState("");
  const [folderItems, setFolderItems] = useState([]);
  const [saving, setSaving] = useState(false);
  const [loadingPages, setLoadingPages] = useState(false);
  const [loadingFolders, setLoadingFolders] = useState(false);

  const loadFolders = async (path = "") => {
    setLoadingFolders(true);
    const res = await KnowledgeSources.dropboxFolders(path);
    setLoadingFolders(false);
    if (res.error) return showToast(res.error, "error");
    setFolderPath(path);
    setFolderItems(res.items || []);
  };

  const refresh = async ({ loadDropbox = false } = {}) => {
    const res = await KnowledgeSources.status();
    setNotionConnected(Boolean(res?.notion?.connected));
    setDropbox({ ...emptyDropbox, ...(res?.dropbox || {}) });
    setSources(res?.sources || []);
    const ws = res?.workspaces || [];
    setWorkspaces(ws);
    if (!workspaceId && ws[0]?.id) setWorkspaceId(String(ws[0].id));
    if (loadDropbox && res?.dropbox?.connected) await loadFolders("");
  };

  useEffect(() => {
    refresh({ loadDropbox: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveNotion = async (e) => {
    e.preventDefault();
    if (!notionToken.trim())
      return showToast("Enter a Notion internal integration token.", "error");
    setSaving(true);
    const result = await KnowledgeSources.saveNotionToken(notionToken.trim());
    setSaving(false);
    if (!result.success)
      return showToast(result.error || "Could not save Notion token.", "error");
    setNotionToken("");
    setNotionConnected(true);
    showToast("Notion token saved.", "success");
    refresh();
  };

  const loadPages = async () => {
    setLoadingPages(true);
    const res = await KnowledgeSources.notionPages();
    setLoadingPages(false);
    if (res.error) return showToast(res.error, "error");
    setPages(res.items || []);
    setSelectedPage(null);
  };

  const watchPage = async () => {
    if (!selectedPage)
      return showToast("Select a Notion page to watch.", "error");
    if (!workspaceId) return showToast("Select a workspace.", "error");
    setSaving(true);
    const result = await KnowledgeSources.watchNotion({
      pageId: selectedPage.id,
      workspaceId,
      display_name: selectedPage.title,
    });
    setSaving(false);
    if (!result.success)
      return showToast(result.error || "Could not watch page.", "error");
    showToast(`Watching “${selectedPage.title}”.`, "success");
    refresh();
  };

  const saveDropboxConfig = async (e) => {
    e.preventDefault();
    setSaving(true);
    const result = await KnowledgeSources.saveDropboxOAuthConfig({
      clientId: dropbox.clientId,
      clientSecret: dropbox.clientSecret,
    });
    setSaving(false);
    if (!result.success)
      return showToast(result.error || "Could not save Dropbox app.", "error");
    if (result.config) setDropbox((prev) => ({ ...prev, ...result.config }));
    showToast("Dropbox app credentials saved.", "success");
  };

  const connectDropbox = async () => {
    if (!dropbox.configured)
      return showToast("Save a Dropbox app key and secret first.", "error");
    const result = await KnowledgeSources.connectDropboxPopup();
    if (!result.success)
      return showToast(result.error || "Dropbox login failed.", "error");
    showToast("Dropbox connected.", "success");
    await refresh();
    loadFolders("");
  };

  const watchFolder = async () => {
    if (!workspaceId) return showToast("Select a workspace.", "error");
    setSaving(true);
    const name = folderPath.split("/").filter(Boolean).pop() || "Dropbox";
    const result = await KnowledgeSources.watchDropbox({
      path: folderPath,
      workspaceId,
      display_name: name,
    });
    setSaving(false);
    if (!result.success)
      return showToast(result.error || "Could not watch folder.", "error");
    showToast(`Watching Dropbox folder “${name}”.`, "success");
    refresh();
  };

  const disconnect = async (source) => {
    const result = await KnowledgeSources.disconnect(source.id);
    if (!result.success)
      return showToast(result.error || "Could not disconnect.", "error");
    showToast("Knowledge source removed.", "success");
    refresh();
  };

  const parentPath = folderPath.split("/").filter(Boolean).slice(0, -1);
  const upPath = parentPath.length ? `/${parentPath.join("/")}` : "";

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
              Knowledge sources
            </p>
            <p className="text-xs leading-[18px] text-theme-text-secondary">
              Connect Notion pages and Dropbox folders, pick what to ingest, and
              watch them hourly (up to 200 items per source).
            </p>
          </div>

          <div className="flex flex-col gap-y-6 mt-6 max-w-[720px]">
            <label className="flex flex-col gap-1.5 max-w-[320px]">
              <span className="text-xs font-medium text-theme-text-secondary">
                Workspace
              </span>
              <select
                className="flex h-9 w-full rounded-lg border border-theme-modal-border bg-theme-settings-input-bg px-3 text-sm text-theme-text-primary"
                value={workspaceId}
                onChange={(e) => setWorkspaceId(e.target.value)}
              >
                {workspaces.length === 0 && (
                  <option value="">No workspaces yet</option>
                )}
                {workspaces.map((ws) => (
                  <option key={ws.id} value={ws.id}>
                    {ws.name}
                  </option>
                ))}
              </select>
            </label>

            <Card
              title="Notion"
              description="Create an internal integration at notion.so/my-integrations, share the pages you want to ingest with it, then paste the token. Pages are crawled to markdown."
            >
              <form className="flex flex-col gap-3" onSubmit={saveNotion}>
                <Field
                  label="Internal integration token"
                  type="password"
                  value={notionToken}
                  onChange={(e) => setNotionToken(e.target.value)}
                  placeholder={
                    notionConnected
                      ? "Token saved — enter a new one to replace"
                      : ""
                  }
                  autoComplete="off"
                />
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={saving} loading={saving}>
                    Save token
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!notionConnected || loadingPages}
                    loading={loadingPages}
                    onClick={loadPages}
                  >
                    Load pages
                  </Button>
                </div>
              </form>
              {pages.length > 0 && (
                <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-theme-modal-border">
                  {pages.map((page) => (
                    <button
                      type="button"
                      key={page.id}
                      onClick={() => setSelectedPage(page)}
                      className={`w-full text-left px-3 py-2 text-sm border-b border-theme-modal-border last:border-b-0 ${
                        selectedPage?.id === page.id
                          ? "bg-theme-file-picker-hover text-theme-text-primary"
                          : "text-theme-text-secondary"
                      }`}
                    >
                      {page.title}
                    </button>
                  ))}
                </div>
              )}
              <Button
                type="button"
                disabled={!selectedPage || !workspaceId || saving}
                onClick={watchPage}
                className="w-fit"
              >
                Watch selected page
              </Button>
            </Card>

            <Card
              title="Dropbox"
              description={
                <>
                  Dropbox app (scoped): <code>files.metadata.read</code>,{" "}
                  <code>files.content.read</code>. Redirect URI:{" "}
                  <code className="text-theme-text-primary">
                    http://localhost:3002/api/knowledge-sources/dropbox/callback
                  </code>
                </>
              }
            >
              <form
                className="flex flex-col gap-3"
                onSubmit={saveDropboxConfig}
              >
                <Field
                  label="App key (client ID)"
                  value={dropbox.clientId}
                  onChange={(e) =>
                    setDropbox((prev) => ({
                      ...prev,
                      clientId: e.target.value,
                    }))
                  }
                  autoComplete="off"
                />
                <Field
                  label="App secret"
                  type="password"
                  value={dropbox.clientSecret}
                  onChange={(e) =>
                    setDropbox((prev) => ({
                      ...prev,
                      clientSecret: e.target.value,
                    }))
                  }
                  autoComplete="off"
                />
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={saving} loading={saving}>
                    Save app
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!dropbox.configured}
                    onClick={connectDropbox}
                  >
                    {dropbox.connected
                      ? `Reconnect${dropbox.accountEmail ? ` (${dropbox.accountEmail})` : ""}`
                      : "Connect Dropbox"}
                  </Button>
                </div>
              </form>
              {dropbox.connected && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-xs text-theme-text-secondary">
                    <span>
                      Folder: {folderPath || "/"} {loadingFolders ? "…" : ""}
                    </span>
                    {folderPath ? (
                      <button
                        type="button"
                        className="underline"
                        onClick={() => loadFolders(upPath)}
                      >
                        Up
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="underline"
                        onClick={() => loadFolders("")}
                      >
                        Refresh
                      </button>
                    )}
                  </div>
                  <div className="max-h-56 overflow-y-auto rounded-lg border border-theme-modal-border">
                    {folderItems.length === 0 && (
                      <p className="px-3 py-2 text-xs text-theme-text-secondary">
                        {loadingFolders
                          ? "Loading…"
                          : "Empty folder — you can still watch this path."}
                      </p>
                    )}
                    {folderItems.map((item) => (
                      <button
                        type="button"
                        key={item.id || item.path}
                        onClick={() =>
                          item.type === "folder"
                            ? loadFolders(item.path || item.path_display)
                            : null
                        }
                        className="w-full text-left px-3 py-2 text-sm text-theme-text-secondary border-b border-theme-modal-border last:border-b-0"
                      >
                        {item.type === "folder" ? "📁 " : "📄 "}
                        {item.name}
                      </button>
                    ))}
                  </div>
                  <Button
                    type="button"
                    disabled={!workspaceId || saving}
                    onClick={watchFolder}
                    className="w-fit"
                  >
                    Watch this folder
                  </Button>
                </div>
              )}
            </Card>

            <Card title="Watched sources">
              {sources.length === 0 ? (
                <p className="text-xs text-theme-text-secondary">
                  Nothing is being watched yet.
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {sources.map((source) => (
                    <li
                      key={source.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-theme-modal-border px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-sm text-theme-text-primary truncate">
                          {source.display_name}
                        </p>
                        <p className="text-[11px] text-theme-text-secondary">
                          {source.provider}
                          {source.workspaceName
                            ? ` · ${source.workspaceName}`
                            : ""}
                          {source.last_synced_at
                            ? ` · synced ${new Date(
                                source.last_synced_at
                              ).toLocaleString()}`
                            : " · not synced yet"}
                          {source.last_error ? ` · ${source.last_error}` : ""}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => disconnect(source)}
                      >
                        Disconnect
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
