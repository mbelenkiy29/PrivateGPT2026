import UploadFile from "../UploadFile";
import PreLoader from "@/components/Preloader";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import FolderRow from "./FolderRow";
import System from "@/models/system";
import { Plus, Trash } from "@phosphor-icons/react";
import SearchInput from "@/components/ui/21st/SearchInput";
import Button from "@/components/ui/21st/Button";
import ExplorerPanel from "@/components/ui/21st/ExplorerPanel";
import Document from "@/models/document";
import showToast from "@/utils/toast";
import FolderSelectionPopup from "./FolderSelectionPopup";
import MoveToFolderIcon from "./MoveToFolderIcon";
import { useModal } from "@/hooks/useModal";
import Modal from "@/components/lib/Modal";
import NewFolderModal from "./NewFolderModal";
import debounce from "lodash.debounce";
import ContextMenu from "./ContextMenu";
import { Tooltip } from "react-tooltip";
import { safeJsonParse } from "@/utils/request";
import useUploadQueue from "../hooks/useUploadQueue";
import { getFilesFromUploadEvent } from "@/utils/folderUpload";
import LoadingState from "@/components/ui/21st/LoadingState";

const NO_FILES = [];

export default function Directory({
  picker,
  workspace,
  hiddenPaths,
  setHighlightWorkspace,
  moveToWorkspace,
}) {
  const { t } = useTranslation();
  const [showFolderSelection, setShowFolderSelection] = useState(false);
  const [contextMenu, setContextMenu] = useState({
    visible: false,
    x: 0,
    y: 0,
  });
  const {
    isOpen: isFolderModalOpen,
    openModal: openFolderModal,
    closeModal: closeFolderModal,
  } = useModal();

  const {
    status,
    busyMessage,
    folders,
    contents,
    expanded,
    searchResults,
    searching,
    hasSelection,
    selectedFolderNames,
    isFileSelected,
    folderSelectionState,
    refresh,
    search,
    syncAfterUpload,
    toggleExpanded,
    prefetchFolder,
    loadMore,
    toggleFile,
    toggleFolder,
    selectAll,
    clearSelection,
    resolveSelection,
    removeFiles,
    addFolder,
    setBusy,
  } = picker;

  /**
   * One flattened view model per visible folder. Search replaces the folder
   * list with the backend's matches (always open); otherwise rows are driven
   * by the lazily-fetched pages held in the picker.
   */
  const rows = useMemo(() => {
    const hide = (folderName, files) =>
      hiddenPaths?.size
        ? files.filter((f) => !hiddenPaths.has(`${folderName}/${f.name}`))
        : files;

    if (searchResults) {
      return searchResults.map((folder) => {
        const files = hide(folder.name, folder.items ?? []);
        return {
          item: folder,
          files,
          expanded: true,
          loading: false,
          hasMore: false,
          totalCount: files.length,
          // The badge counts matches, not the folder's size - showing "(200)"
          // next to three visible rows reads as a bug.
          displayCount: files.length,
        };
      });
    }

    return folders.map((folder) => {
      const entry = contents[folder.name];
      const files = entry ? hide(folder.name, entry.items) : NO_FILES;
      const hasMore = entry?.hasMore ?? false;
      // totalCount is the server's raw count and drives "Load more (x of y)".
      const totalCount = entry?.totalCount ?? folder.fileCount ?? 0;
      return {
        item: folder,
        files,
        expanded: expanded.has(folder.name),
        loading: entry?.status === "loading",
        hasMore,
        totalCount,
        // Once a folder is fully fetched we know exactly how many rows it can
        // show - embedded files are filtered out of the page, so a folder with
        // everything embedded must read as empty rather than still claiming
        // its on-disk count.
        displayCount:
          entry?.status === "loaded" && !hasMore ? files.length : totalCount,
      };
    });
  }, [folders, contents, expanded, searchResults, hiddenPaths]);

  const totalDocCount = useMemo(
    () => folders.reduce((acc, folder) => acc + (folder.fileCount ?? 0), 0),
    [folders]
  );

  // While searching, the library-wide total is misleading next to a filtered
  // list, so the header reports how many matches are on screen instead.
  const searchResultCount = useMemo(
    () =>
      searchResults ? rows.reduce((acc, row) => acc + row.files.length, 0) : 0,
    [searchResults, rows]
  );

  /* --------------------------------- search -------------------------------- */

  const handleSearch = useMemo(
    () => debounce((event) => search(event.target.value), 400),
    [search]
  );
  useEffect(() => () => handleSearch.cancel(), [handleSearch]);

  /* -------------------------------- mutations ------------------------------ */

  const deleteFiles = async (event) => {
    event.stopPropagation();
    if (!window.confirm(t("connectors.directory.delete-confirmation"))) return;

    const selected = await resolveSelection();
    const toRemove = selected.map((file) => `${file.folderName}/${file.name}`);
    const foldersToRemove = selectedFolderNames.filter(
      (name) => name !== "custom-documents"
    );

    setBusy(
      t("connectors.directory.removing-message", {
        count: toRemove.length,
        folderCount: foldersToRemove.length,
      })
    );
    try {
      if (toRemove.length > 0) await System.deleteDocuments(toRemove);
      for (const folderName of foldersToRemove)
        await System.deleteFolder(folderName);
      removeFiles(selected.map((file) => file.id));
      clearSelection();
      await refresh();
    } catch (error) {
      console.error("Failed to delete files and folders:", error);
      showToast(`Failed to delete: ${error.message}`, "error");
    } finally {
      setBusy(null);
    }
  };

  const moveToFolder = async (folder) => {
    setShowFolderSelection(false);
    const toMove = await resolveSelection();
    if (toMove.length === 0) return;

    setBusy(`Moving ${toMove.length} documents. Please wait.`);
    const { success, message } = await Document.moveToFolder(
      toMove,
      folder.name
    );
    if (!success) {
      showToast(`Error moving files: ${message}`, "error");
      setBusy(null);
      return;
    }

    // A partial success returns a message explaining which files were skipped.
    if (message) showToast(message, "info");
    else
      showToast(
        t("connectors.directory.move-success", { count: toMove.length }),
        "success"
      );

    clearSelection();
    await refresh();
    setBusy(null);
  };

  /**
   * Dropping files onto a folder row uploads them straight into that folder,
   * so the user does not have to upload and then move. Progress is reported
   * in the shared uploader below the picker.
   */
  const uploadQueue = useUploadQueue();
  const { enqueueIntoFolder } = uploadQueue;
  const handleFolderDrop = useCallback(
    async (folderName, event) => {
      // Must be called before anything awaits: a drop's DataTransferItems are
      // only readable while the drop event is being dispatched.
      const dropped = await getFilesFromUploadEvent(event.nativeEvent ?? event);
      const { queued, skipped } = enqueueIntoFolder(dropped, folderName);

      if (queued === 0)
        return showToast(
          skipped > 0
            ? `Drop files onto ${folderName}, not folders - a folder can only be dropped on the uploader below.`
            : "Nothing in that drop could be uploaded.",
          "warning"
        );

      // The progress list lives in the uploader below the picker, which may be
      // scrolled out of view - confirm the drop landed so it does not look
      // like nothing happened.
      showToast(`Uploading ${queued} file(s) to ${folderName}`, "info");
      if (skipped > 0)
        showToast(
          `${skipped} file(s) inside folders were skipped - drop a folder on the uploader below to add it as its own folder.`,
          "warning"
        );
    },
    [enqueueIntoFolder]
  );

  const handleFolderCreated = useCallback(
    (name) => {
      addFolder(name);
      closeFolderModal();
    },
    [addFolder, closeFolderModal]
  );

  const handleContextMenu = (event) => {
    event.preventDefault();
    setContextMenu({ visible: true, x: event.clientX, y: event.clientY });
  };
  const closeContextMenu = useCallback(
    () => setContextMenu({ visible: false, x: 0, y: 0 }),
    []
  );

  const countLabel = searchResults
    ? t(`connectors.directory.search-results`, { count: searchResultCount })
    : totalDocCount > 0
      ? t(`connectors.directory.total-documents`, { count: totalDocCount })
      : t("connectors.directory.no-documents");

  return (
    <>
      <div className="flex flex-col gap-2" onContextMenu={handleContextMenu}>
        <ExplorerPanel
          title={t("connectors.directory.my-documents")}
          description={countLabel}
          actions={
            <>
              <SearchInput
                className="w-[160px]"
                placeholder={t("connectors.directory.search-document")}
                onChange={handleSearch}
                loading={searching}
              />
              <Button variant="ghost" size="sm" onClick={openFolderModal}>
                <Plus size={14} weight="bold" />
                {t("connectors.directory.new-folder")}
              </Button>
            </>
          }
          columnLabels={
            <>
              <span>Name</span>
              <span>{searchResults ? "Matches" : "Count"}</span>
            </>
          }
          footer={
            hasSelection ? (
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-theme-text-secondary">
                  Selected
                </p>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    onClick={moveToWorkspace}
                    onMouseEnter={() => setHighlightWorkspace(true)}
                    onMouseLeave={() => setHighlightWorkspace(false)}
                  >
                    {t("connectors.directory.move-workspace")}
                  </Button>
                  <div className="relative">
                    <Button
                      variant="secondary"
                      size="icon"
                      onClick={() =>
                        setShowFolderSelection(!showFolderSelection)
                      }
                    >
                      <MoveToFolderIcon className="text-theme-text-primary" />
                    </Button>
                    {showFolderSelection && (
                      <FolderSelectionPopup
                        folders={folders}
                        onSelect={moveToFolder}
                        onClose={() => setShowFolderSelection(false)}
                      />
                    )}
                  </div>
                  <Button variant="ghost" size="icon" onClick={deleteFiles}>
                    <Trash size={16} weight="bold" />
                  </Button>
                </div>
              </div>
            ) : null
          }
        >
          {!!busyMessage && (
            <div className="sticky top-0 z-20 flex items-center justify-center gap-x-2 bg-theme-bg-secondary/95 border-b border-theme-modal-border py-1.5">
              <LoadingState size="grid" variant="drive" />
              <p className="text-theme-text-primary text-xs font-medium">
                {busyMessage}
              </p>
            </div>
          )}
          {status === "initializing" ? (
            <div className="w-full h-[280px] flex items-center justify-center">
              <PreLoader />
            </div>
          ) : rows.length > 0 ? (
            rows.map((row) => (
              <FolderRow
                key={row.item.name}
                item={row.item}
                files={row.files}
                expanded={row.expanded}
                loading={row.loading}
                hasMore={row.hasMore}
                totalCount={row.totalCount}
                displayCount={row.displayCount}
                selectionState={folderSelectionState(row.item.name, row.files)}
                isFileSelected={(id) => isFileSelected(row.item.name, id)}
                onToggleExpanded={toggleExpanded}
                onToggleFolder={(folder) => toggleFolder(folder, row.files)}
                onToggleFile={toggleFile}
                onPrefetch={prefetchFolder}
                onLoadMore={loadMore}
                acceptsDrops={uploadQueue.ready}
                onDropFiles={handleFolderDrop}
              />
            ))
          ) : (
            <div className="w-full h-[280px] flex items-center justify-center">
              <p className="text-theme-text-secondary text-sm font-medium">
                {t("connectors.directory.no-documents")}
              </p>
            </div>
          )}
        </ExplorerPanel>
        <UploadFile
          workspace={workspace}
          queue={uploadQueue}
          onUploadComplete={syncAfterUpload}
          onLinkScraped={syncAfterUpload}
        />
        <Modal isOpen={isFolderModalOpen} onClose={closeFolderModal} noPortal>
          <NewFolderModal
            closeModal={closeFolderModal}
            onCreated={handleFolderCreated}
          />
        </Modal>
        <ContextMenu
          contextMenu={contextMenu}
          closeContextMenu={closeContextMenu}
          allSelected={
            hasSelection && selectedFolderNames.length === folders.length
          }
          onSelectAll={selectAll}
          onClearSelection={clearSelection}
        />
      </div>
      <DirectoryTooltips />
    </>
  );
}

/**
 * Tooltips for the directory components. Renders when the directory is shown
 * or updated so that tooltips are attached as the items are changed.
 */
function DirectoryTooltips() {
  return (
    <Tooltip
      id="directory-item"
      place="bottom"
      delayShow={800}
      className="tooltip invert light:invert-0 z-99 max-w-[300px]"
      render={({ content }) => {
        const data = safeJsonParse(content, null);
        if (!data) return null;
        return (
          <div className="text-xs">
            <p className="text-white light:invert font-medium break-all">
              {data.title}
            </p>
            <div className="flex flex-col mt-1">
              <p className="">
                Date: <b>{data.date}</b>
              </p>
              <p className="">
                Type: <b>{data.extension}</b>
              </p>
            </div>
          </div>
        );
      }}
    />
  );
}
