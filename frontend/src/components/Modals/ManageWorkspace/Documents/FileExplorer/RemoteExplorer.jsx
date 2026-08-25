import { useCallback, useEffect, useMemo, useState } from "react";
import { Plugs, Cloud, FolderNotch, File, Plus } from "@phosphor-icons/react";
import FileSources from "@/models/fileSources";
import showToast from "@/utils/toast";
import paths from "@/utils/paths";
import { Link } from "react-router-dom";
import EmptyState from "@/components/ui/21st/EmptyState";
import FileTreeRow from "@/components/ui/21st/FileTreeRow";
import Button from "@/components/ui/21st/Button";
import SearchInput from "@/components/ui/21st/SearchInput";
import Breadcrumb from "@/components/ui/21st/Breadcrumb";
import ExplorerPanel from "@/components/ui/21st/ExplorerPanel";
import LoadingState from "@/components/ui/21st/LoadingState";

const PROVIDER_LABELS = {
  "google-drive": "Google Drive",
  onedrive: "OneDrive",
  sharepoint: "SharePoint",
  "teams-files": "Teams files",
};

function providerLabel(provider) {
  return PROVIDER_LABELS[provider] || "cloud drive";
}

function homeLabelFor(provider) {
  if (provider === "sharepoint") return "Sites";
  if (provider === "teams-files") return "Teams";
  return "Home";
}

function connectCopy(provider) {
  if (provider === "sharepoint")
    return "Pick a site, then a document library. Uses Microsoft Graph (Sites.Read.All) with the same Azure app as OneDrive. A Teams bot is a separate consent and is not required to index files.";
  if (provider === "teams-files")
    return "Pick a team, then a channel files folder. Graph consent indexes files; the Teams chat bot is a separate install and is not used here.";
  return "Browse folders, pick files, and index them into this workspace so the model can use them in chat.";
}

export default function RemoteExplorer({ source, workspace, onIndexed }) {
  const [parentStack, setParentStack] = useState([
    { id: "root", name: "Home" },
  ]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [query, setQuery] = useState("");
  const [connecting, setConnecting] = useState(false);

  const current = parentStack[parentStack.length - 1];
  const connected = !!source?.connected;
  const driveName = providerLabel(source?.provider);
  const homeLabel = homeLabelFor(source?.provider);
  const connectDescription = connectCopy(source?.provider);

  const load = useCallback(
    async (parentId, search = "") => {
      if (!source?.id) return;
      setLoading(true);
      const data = search
        ? await FileSources.search(source.id, search)
        : await FileSources.children(source.id, parentId);
      if (data.error) showToast(data.error, "error", { clear: true });
      setItems(data.items || []);
      setLoading(false);
    },
    [source?.id]
  );

  useEffect(() => {
    setParentStack([{ id: "root", name: homeLabel }]);
    setSelected(new Set());
    setQuery("");
    if (connected) load("root");
    else setItems([]);
  }, [source?.id, connected, load, homeLabel]);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openFolder = (item) => {
    setQuery("");
    setParentStack((s) => [...s, { id: item.id, name: item.name }]);
    load(item.id);
  };

  const goTo = (index) => {
    const next = parentStack.slice(0, index + 1);
    setParentStack(next);
    setQuery("");
    load(next[next.length - 1].id);
  };

  const onSearch = async (e) => {
    const value = e.target.value;
    setQuery(value);
    if (!value.trim()) return load(current.id);
    load(current.id, value.trim());
  };

  const handleConnect = async () => {
    setConnecting(true);
    const result = await FileSources.connectPopup(source.provider);
    setConnecting(false);
    if (!result.success)
      return showToast(result.error || "Could not connect.", "error");
    showToast(`${driveName} connected.`, "success");
    onIndexed?.(true);
  };

  const handleIndex = async () => {
    if (selected.size === 0) return;
    setIndexing(true);
    const result = await FileSources.index(source.id, {
      fileIds: [...selected],
      workspaceSlug: workspace.slug,
    });
    setIndexing(false);
    if (!result.success)
      return showToast(result.error || "Indexing failed.", "error", {
        clear: true,
      });
    showToast(
      `Indexed ${result.indexed} file(s)${
        result.failed ? `, ${result.failed} failed` : ""
      }.`,
      result.failed ? "warning" : "success",
      { clear: true }
    );
    setSelected(new Set());
    onIndexed?.();
  };

  const handleDisconnect = async () => {
    if (!source?.id) return;
    await FileSources.disconnect(source.id);
    showToast("Disconnected.", "success");
    onIndexed?.(true);
  };

  const visible = useMemo(
    () => items.filter((item) => item.type === "folder" || item.indexable),
    [items]
  );

  if (!connected) {
    return (
      <EmptyState
        className="h-[420px] rounded-xl"
        title={`Connect ${driveName}`}
        description={connectDescription}
        icons={[
          <FolderNotch key="f" size={18} />,
          <Cloud key="c" size={20} />,
          <File key="d" size={18} />,
        ]}
        action={{
          label: connecting ? "Opening login…" : "Connect",
          icon: <Plus size={14} />,
          disabled: connecting,
          onClick: handleConnect,
          hint: (
            <Link
              to={paths.settings.cloudDrives()}
              className="mt-3 block text-[11px] text-theme-text-secondary hover:text-theme-text-primary"
            >
              Add API credentials
            </Link>
          ),
        }}
      />
    );
  }

  return (
    <ExplorerPanel
      title={source.accountName || source.accountEmail || driveName}
      description={source.accountEmail}
      actions={
        <>
          <SearchInput
            className="w-[150px]"
            value={query}
            onChange={onSearch}
            placeholder="Search files"
          />
          <Button variant="ghost" size="sm" onClick={handleDisconnect}>
            <Plugs size={12} /> Disconnect
          </Button>
        </>
      }
      columnLabels={
        <>
          <span>Name</span>
          <span>Type</span>
        </>
      }
      footer={
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-theme-text-secondary">
            {selected.size} selected
          </p>
          <Button
            size="sm"
            disabled={selected.size === 0 || indexing}
            loading={indexing}
            onClick={handleIndex}
          >
            {indexing ? "Indexing…" : "Index selected"}
          </Button>
        </div>
      }
    >
      {!query && (
        <div className="px-3 py-2">
          <Breadcrumb items={parentStack} onSelect={goTo} />
        </div>
      )}
      {loading ? (
        <div className="flex items-center justify-center h-[240px] text-theme-text-secondary">
          <LoadingState size="grid" variant="drive" />
        </div>
      ) : visible.length === 0 ? (
        <p className="text-xs text-theme-text-secondary p-4">
          No files in this folder.
        </p>
      ) : (
        visible.map((item) => (
          <FileTreeRow
            key={item.id}
            type={item.type}
            name={item.name}
            selected={selected.has(item.id)}
            onToggle={
              item.type === "folder" && item.indexable === false
                ? undefined
                : () => toggle(item.id)
            }
            onActivate={() => openFolder(item)}
            meta={
              item.type !== "folder"
                ? "File"
                : item.siteId && !item.driveId
                  ? "Site"
                  : item.teamId && !item.channelId
                    ? "Team"
                    : "Folder"
            }
            badge={
              item.type === "file" && !item.indexable ? (
                <span className="text-[10px] text-theme-text-secondary">
                  skip
                </span>
              ) : null
            }
          />
        ))
      )}
    </ExplorerPanel>
  );
}
