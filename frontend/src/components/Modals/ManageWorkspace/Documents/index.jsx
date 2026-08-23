import { ArrowRight } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Workspace from "../../../../models/workspace";
import showToast from "../../../../utils/toast";
import Directory from "./Directory";
import WorkspaceDirectory from "./WorkspaceDirectory";
import useDocumentPicker from "./hooks/useDocumentPicker";
import { useWorkspaceEmbeddingProgress } from "@/EmbeddingProgressContext";
import SourceRail from "./FileExplorer/SourceRail";
import RemoteExplorer from "./FileExplorer/RemoteExplorer";
import FileSources from "@/models/fileSources";

export default function DocumentSettings({ workspace }) {
  const [highlightWorkspace, setHighlightWorkspace] = useState(false);
  const [movedItems, setMovedItems] = useState([]);
  // Busy state local to the workspace (right) panel - removing embeddings.
  const [wsBusy, setWsBusy] = useState(false);
  const [wsBusyMessage, setWsBusyMessage] = useState("");
  const picker = useDocumentPicker(workspace);
  const {
    refresh,
    resolveSelection,
    removeFiles,
    clearSelection,
    workspaceDocs: embeddedDocs,
  } = picker;
  const hasChanges = movedItems.length > 0;

  const { embeddingProgress, startEmbedding } = useWorkspaceEmbeddingProgress(
    workspace.slug,
    { onProgressCleared: refresh }
  );

  /**
   * Files mid-embed are shown in the workspace panel, so hide them from the
   * picker to avoid rendering the same document on both sides.
   */
  const hiddenPaths = useMemo(
    () => new Set(Object.keys(embeddingProgress ?? {})),
    [embeddingProgress]
  );

  /**
   * Stage the current selection for embedding. Files are removed from the
   * picker optimistically - no refetch, so the move is instant.
   */
  const moveSelectedItemsToWorkspace = useCallback(async () => {
    setHighlightWorkspace(false);
    const resolved = await resolveSelection();
    if (resolved.length === 0) return clearSelection();

    setMovedItems((prev) => {
      const seen = new Set(prev.map((item) => item.id));
      return [...prev, ...resolved.filter((item) => !seen.has(item.id))];
    });
    removeFiles(resolved.map((item) => item.id));
    clearSelection();
  }, [resolveSelection, removeFiles, clearSelection]);

  const updateWorkspace = async (e) => {
    e?.preventDefault();
    const filenames = movedItems.map(
      (item) => `${item.folderName}/${item.name}`
    );

    setMovedItems([]);
    setHighlightWorkspace(false);
    clearSelection();

    // Fire the embed POST first so the server is already processing the job
    // by the time the SSE connection opens. This avoids the server sending
    // idle (no active job) before embedding has started.
    const embedPromise = Workspace.modifyEmbeddings(workspace.slug, {
      adds: filenames,
    });
    startEmbedding(workspace.slug, filenames);
    embedPromise.catch((error) => {
      showToast(`Workspace update failed: ${error}`, "error", { clear: true });
    });
  };

  /** Merge not-yet-embedded staged files into the workspace panel. */
  const workspaceDocs = useMemo(() => {
    if (movedItems.length === 0) return embeddedDocs;
    const items = embeddedDocs.items.map((f) => ({
      ...f,
      items: [...f.items],
    }));
    for (const moved of movedItems) {
      let folder = items.find((f) => f.name === moved.folderName);
      if (!folder) {
        folder = { name: moved.folderName, type: "folder", items: [] };
        items.push(folder);
      }
      if (!folder.items.some((item) => item.id === moved.id))
        folder.items.push(moved);
    }
    return { ...embeddedDocs, items };
  }, [embeddedDocs, movedItems]);

  const initializing = picker.status === "initializing";
  const [activeSource, setActiveSource] = useState("local");
  const [fileSourceState, setFileSourceState] = useState({
    sources: {},
    oauth: {},
  });

  const loadFileSources = useCallback(async () => {
    const data = await FileSources.list();
    setFileSourceState({
      sources: data.sources || {},
      oauth: data.oauth || {},
    });
  }, []);

  useEffect(() => {
    loadFileSources();
  }, [loadFileSources]);

  const handleRemoteIndexed = useCallback(
    async (reloadConnections = false) => {
      if (reloadConnections) await loadFileSources();
      await refresh();
    },
    [loadFileSources, refresh]
  );

  return (
    <div className="flex upload-modal z-10 relative w-full max-w-[1040px] items-stretch gap-3 px-4 pb-4">
      <div className="flex flex-col flex-1 min-w-0">
        <SourceRail
          selected={activeSource}
          onSelect={setActiveSource}
          sources={fileSourceState.sources}
          oauth={fileSourceState.oauth}
        />
        {activeSource === "local" ? (
          <Directory
            picker={picker}
            workspace={workspace}
            hiddenPaths={hiddenPaths}
            setHighlightWorkspace={setHighlightWorkspace}
            moveToWorkspace={moveSelectedItemsToWorkspace}
          />
        ) : (
          <RemoteExplorer
            source={
              fileSourceState.sources[activeSource] || {
                provider: activeSource,
                connected: false,
              }
            }
            workspace={workspace}
            onIndexed={handleRemoteIndexed}
          />
        )}
      </div>
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        className="upload-modal-arrow self-center shrink-0 size-9 rounded-full border border-theme-modal-border bg-theme-bg-primary text-theme-text-secondary flex items-center justify-center pointer-events-none max-[1330px]:rotate-90"
      >
        <ArrowRight size={16} weight="bold" />
      </button>
      <div className="flex flex-col flex-1 min-w-0">
        <WorkspaceDirectory
          workspace={workspace}
          files={workspaceDocs}
          highlightWorkspace={highlightWorkspace}
          loading={initializing || wsBusy}
          loadingMessage={wsBusyMessage}
          setLoadingMessage={setWsBusyMessage}
          setLoading={setWsBusy}
          fetchKeys={refresh}
          hasChanges={hasChanges}
          saveChanges={updateWorkspace}
          movedItems={movedItems}
        />
      </div>
    </div>
  );
}
