import PreLoader from "@/components/Preloader";
import WorkspaceFileRow from "./WorkspaceFileRow";
import { memo, useEffect, useState } from "react";
import Modal, {
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalPrimaryButton,
} from "@/components/lib/Modal";
import {
  Eye,
  PushPin,
  CheckCircle,
  XCircle,
  CircleNotch,
  Clock,
  X,
} from "@phosphor-icons/react";
import { SEEN_DOC_PIN_ALERT, SEEN_WATCH_ALERT } from "@/utils/constants";
import paths from "@/utils/paths";
import { Link } from "react-router-dom";
import Workspace from "@/models/workspace";
import { Tooltip } from "react-tooltip";
import { safeJsonParse } from "@/utils/request";
import { useTranslation } from "react-i18next";
import Button from "@/components/ui/21st/Button";
import ExplorerPanel from "@/components/ui/21st/ExplorerPanel";
import { middleTruncate } from "@/utils/directories";
import { useEmbeddingProgress } from "@/EmbeddingProgressContext";

function WorkspaceDirectory({
  workspace,
  files,
  highlightWorkspace,
  loading,
  loadingMessage,
  setLoadingMessage,
  setLoading,
  fetchKeys,
  hasChanges,
  saveChanges,
  movedItems,
}) {
  const { t } = useTranslation();
  const { embeddingProgressMap, removeQueuedFile } = useEmbeddingProgress();
  const embeddingProgress = embeddingProgressMap[workspace.slug] || null;
  const [selectedItems, setSelectedItems] = useState({});
  const embeddedDocCount = (files?.items ?? []).reduce(
    (sum, folder) => sum + (folder.items?.length ?? 0),
    0
  );

  const toggleSelection = (item) => {
    setSelectedItems((prevSelectedItems) => {
      const newSelectedItems = { ...prevSelectedItems };
      if (newSelectedItems[item.id]) {
        delete newSelectedItems[item.id];
      } else {
        newSelectedItems[item.id] = true;
      }
      return newSelectedItems;
    });
  };

  const toggleSelectAll = () => {
    const allItems = files.items.flatMap((folder) => folder.items);
    const allSelected = allItems.every((item) => selectedItems[item.id]);
    if (allSelected) {
      setSelectedItems({});
    } else {
      const newSelectedItems = {};
      allItems.forEach((item) => {
        newSelectedItems[item.id] = true;
      });
      setSelectedItems(newSelectedItems);
    }
  };

  const removeSelectedItems = async () => {
    setLoading(true);
    setLoadingMessage("Removing selected files from workspace");

    const itemsToRemove = Object.keys(selectedItems).map((itemId) => {
      const folder = files.items.find((f) =>
        f.items.some((i) => i.id === itemId)
      );
      const item = folder.items.find((i) => i.id === itemId);
      return `${folder.name}/${item.name}`;
    });

    try {
      await Workspace.modifyEmbeddings(workspace.slug, {
        adds: [],
        deletes: itemsToRemove,
      });
      await fetchKeys(true);
      setSelectedItems({});
    } catch (error) {
      console.error("Failed to remove documents:", error);
    }

    setLoadingMessage("");
    setLoading(false);
  };

  const handleSaveChanges = (e) => {
    setSelectedItems({});
    saveChanges(e);
  };

  if (loading) {
    return (
      <ExplorerPanel
        title={workspace.name}
        description={loadingMessage || "Loading…"}
      >
        <div className="w-full h-[280px] flex items-center justify-center flex-col gap-y-4">
          <PreLoader />
          <p className="text-theme-text-secondary text-sm animate-pulse text-center px-8">
            {loadingMessage}
          </p>
        </div>
      </ExplorerPanel>
    );
  }

  if (embeddingProgress) {
    return (
      <ExplorerPanel
        title={workspace.name}
        description="Embedding"
        columnLabels={
          <>
            <span>Name</span>
            <span>Status</span>
          </>
        }
        footer={
          hasChanges && movedItems.length > 0 ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-theme-text-secondary">
                {movedItems.length} additional file(s) ready to embed
              </p>
              <Button size="sm" onClick={handleSaveChanges}>
                Add to queue
              </Button>
            </div>
          ) : null
        }
      >
        {Object.entries(embeddingProgress).map(([filename, fileStatus]) => (
          <EmbeddingFileRow
            key={filename}
            filename={filename}
            status={fileStatus}
            onRemove={
              fileStatus.status === "pending"
                ? () => removeQueuedFile(workspace.slug, filename)
                : null
            }
          />
        ))}
      </ExplorerPanel>
    );
  }

  const selectedCount = Object.keys(selectedItems).length;
  const totalFiles = files.items.reduce(
    (sum, folder) => sum + folder.items.length,
    0
  );
  const allSelected = totalFiles > 0 && selectedCount === totalFiles;

  return (
    <>
      <ExplorerPanel
        title={workspace.name}
        description={
          embeddedDocCount > 0
            ? t(`connectors.directory.total-documents`, {
                count: embeddedDocCount,
              })
            : t("connectors.directory.no_docs")
        }
        highlight={highlightWorkspace}
        columnLabels={
          <>
            <span>Name</span>
            <span>Actions</span>
          </>
        }
        footer={
          hasChanges ? (
            <div className="flex items-center justify-end">
              <Button size="sm" onClick={(e) => handleSaveChanges(e)}>
                {t("connectors.directory.save_embed")}
              </Button>
            </div>
          ) : selectedCount > 0 ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-theme-text-secondary">
                {selectedCount} selected
              </p>
              <div className="flex items-center gap-1.5">
                <Button variant="secondary" size="sm" onClick={toggleSelectAll}>
                  {allSelected
                    ? t("connectors.directory.deselect_all")
                    : t("connectors.directory.select_all")}
                </Button>
                <Button size="sm" onClick={removeSelectedItems}>
                  {t("connectors.directory.remove_selected")}
                </Button>
              </div>
            </div>
          ) : null
        }
      >
        {files.items.some((folder) => folder.items.length > 0) ||
        movedItems.length > 0 ? (
          <RenderFileRows
            files={files}
            movedItems={movedItems}
            workspace={workspace}
          >
            {({ item, folder }) => (
              <WorkspaceFileRow
                key={item.id}
                item={item}
                folderName={folder.name}
                workspace={workspace}
                setLoading={setLoading}
                setLoadingMessage={setLoadingMessage}
                fetchKeys={fetchKeys}
                hasChanges={hasChanges}
                movedItems={movedItems}
                selected={selectedItems[item.id]}
                toggleSelection={() => toggleSelection(item)}
                disableSelection={hasChanges}
                setSelectedItems={setSelectedItems}
              />
            )}
          </RenderFileRows>
        ) : (
          <div className="w-full h-[280px] flex items-center justify-center">
            <p className="text-theme-text-secondary text-sm font-medium">
              {t("connectors.directory.no_docs")}
            </p>
          </div>
        )}
      </ExplorerPanel>
      <PinAlert />
      <DocumentWatchAlert />
      <WorkspaceDocumentTooltips />
    </>
  );
}

const PinAlert = memo(() => {
  const { t } = useTranslation();
  const [showAlert, setShowAlert] = useState(false);
  function dismissAlert() {
    setShowAlert(false);
    window.localStorage.setItem(SEEN_DOC_PIN_ALERT, "1");
    window.removeEventListener(handlePinEvent);
  }

  function handlePinEvent() {
    if (!!window?.localStorage?.getItem(SEEN_DOC_PIN_ALERT)) return;
    setShowAlert(true);
  }

  useEffect(() => {
    if (!window || !!window?.localStorage?.getItem(SEEN_DOC_PIN_ALERT)) return;
    window?.addEventListener("pinned_document", handlePinEvent);
  }, []);

  return (
    <Modal isOpen={showAlert} noPortal={true} onClose={dismissAlert}>
      <ModalHeader
        title={
          <span className="flex items-center gap-x-2">
            <PushPin className="w-6 h-6" weight="regular" />
            {t("connectors.pinning.what_pinning")}
          </span>
        }
        onClose={dismissAlert}
      />
      <ModalBody>
        <div className="w-full text-zinc-300 light:text-slate-700 text-md flex flex-col gap-y-2">
          <p>
            <span
              dangerouslySetInnerHTML={{
                __html: t("connectors.pinning.pin_explained_block1"),
              }}
            />
          </p>
          <p>
            <span
              dangerouslySetInnerHTML={{
                __html: t("connectors.pinning.pin_explained_block2"),
              }}
            />
          </p>
          <p>{t("connectors.pinning.pin_explained_block3")}</p>
        </div>
      </ModalBody>
      <ModalFooter className="justify-end">
        <ModalPrimaryButton onClick={dismissAlert}>
          {t("connectors.pinning.accept")}
        </ModalPrimaryButton>
      </ModalFooter>
    </Modal>
  );
});

const DocumentWatchAlert = memo(() => {
  const { t } = useTranslation();
  const [showAlert, setShowAlert] = useState(false);
  function dismissAlert() {
    setShowAlert(false);
    window.localStorage.setItem(SEEN_WATCH_ALERT, "1");
    window.removeEventListener(handlePinEvent);
  }

  function handlePinEvent() {
    if (!!window?.localStorage?.getItem(SEEN_WATCH_ALERT)) return;
    setShowAlert(true);
  }

  useEffect(() => {
    if (!window || !!window?.localStorage?.getItem(SEEN_WATCH_ALERT)) return;
    window?.addEventListener("watch_document_for_changes", handlePinEvent);
  }, []);

  return (
    <Modal isOpen={showAlert} noPortal={true} onClose={dismissAlert}>
      <ModalHeader
        title={
          <span className="flex items-center gap-x-2">
            <Eye className="w-6 h-6" weight="regular" />
            {t("connectors.watching.what_watching")}
          </span>
        }
        onClose={dismissAlert}
      />
      <ModalBody>
        <div className="w-full text-zinc-300 light:text-slate-700 text-md flex flex-col gap-y-2">
          <p>
            <span
              dangerouslySetInnerHTML={{
                __html: t("connectors.watching.watch_explained_block1"),
              }}
            />
          </p>
          <p>{t("connectors.watching.watch_explained_block2")}</p>
          <p>
            {t("connectors.watching.watch_explained_block3_start")}
            <Link
              to={paths.experimental.liveDocumentSync.manage()}
              className="text-blue-600 underline"
            >
              {t("connectors.watching.watch_explained_block3_link")}
            </Link>
            {t("connectors.watching.watch_explained_block3_end")}
          </p>
        </div>
      </ModalBody>
      <ModalFooter className="justify-end">
        <ModalPrimaryButton onClick={dismissAlert}>
          {t("connectors.watching.accept")}
        </ModalPrimaryButton>
      </ModalFooter>
    </Modal>
  );
});

function RenderFileRows({ files, movedItems, children, workspace }) {
  function sortMovedItemsAndFiles(a, b) {
    const aIsMovedItem = movedItems.some((movedItem) => movedItem.id === a.id);
    const bIsMovedItem = movedItems.some((movedItem) => movedItem.id === b.id);
    if (aIsMovedItem && !bIsMovedItem) return -1;
    if (!aIsMovedItem && bIsMovedItem) return 1;

    // Sort pinned items to the top
    const aIsPinned = a.pinnedWorkspaces?.includes(workspace.id);
    const bIsPinned = b.pinnedWorkspaces?.includes(workspace.id);
    if (aIsPinned && !bIsPinned) return -1;
    if (!aIsPinned && bIsPinned) return 1;

    return 0;
  }

  return files.items
    .flatMap((folder) => folder.items)
    .sort(sortMovedItemsAndFiles)
    .map((item) => {
      const folder = files.items.find((f) => f.items.includes(item));
      return children({ item, folder });
    });
}

/**
 * Tooltips for the workspace directory components. Renders when the workspace directory is shown
 * or updated so that tooltips are attached as the items are changed.
 */
function WorkspaceDocumentTooltips() {
  return (
    <>
      <Tooltip
        id="ws-directory-item"
        place="bottom"
        delayShow={800}
        className="tooltip invert light:invert-0 z-99 max-w-[200px]"
        render={({ content }) => {
          const data = safeJsonParse(content, null);
          if (!data) return null;
          return (
            <div className="text-xs">
              <p className="text-white light:invert font-medium break-all">
                {data.title}
              </p>
              <div className="flex mt-1 gap-x-2">
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
      <Tooltip
        id="watch-changes"
        place="bottom"
        delayShow={300}
        className="tooltip invert !text-xs"
      />
      <Tooltip
        id="pin-document"
        place="bottom"
        delayShow={300}
        className="tooltip invert !text-xs"
      />
      <Tooltip
        id="remove-document"
        place="bottom"
        delayShow={300}
        className="tooltip invert !text-xs"
      />
    </>
  );
}

/**
 * @param {string} filename
 */
const getDisplayName = (filename) => {
  const base = filename.split("/").pop() || filename;
  return base.replace(
    /-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.json$/,
    ""
  );
};

const STATUS_STYLES = {
  pending: {
    icon: (
      <Clock
        size={16}
        className="text-slate-100 light:text-slate-900/40 shrink-0"
        weight="regular"
      />
    ),
    textColor: "text-slate-100 light:text-slate-900/70",
    label: "Queued",
  },
  embedding: {
    icon: (
      <CircleNotch
        size={16}
        className="text-slate-100 light:text-slate-900/40 animate-spin shrink-0"
        weight="bold"
      />
    ),
    textColor: "text-slate-100 light:text-slate-900/70",
    label: "Embedding",
  },
  complete: {
    icon: (
      <CheckCircle
        size={16}
        className="text-green-400 light:text-green-600 shrink-0"
        weight="fill"
      />
    ),
    textColor: "text-green-400 light:text-green-600",
    label: "Complete",
  },
  failed: {
    icon: (
      <XCircle
        size={16}
        className="text-red-400 light:text-red-600 shrink-0"
        weight="fill"
      />
    ),
    textColor: "text-red-400 light:text-red-600",
    label: "Failed",
  },
};

function EmbeddingFileRow({ filename, status: fileStatus, onRemove }) {
  const { status, chunksProcessed = 0, totalChunks = 0 } = fileStatus;
  const displayName = getDisplayName(filename);
  const isEmbedding = status === "embedding";
  const pct =
    isEmbedding && totalChunks > 0
      ? Math.round((chunksProcessed / totalChunks) * 100)
      : 0;

  return (
    <div className="text-slate-100 light:text-slate-900 text-xs grid grid-cols-12 py-2 pl-3.5 pr-3.5 h-[34px] items-center border-b border-white/5">
      <div className="col-span-7 flex items-center gap-x-2 overflow-hidden">
        {STATUS_STYLES[status]?.icon || STATUS_STYLES.pending.icon}
        <p
          className={`whitespace-nowrap overflow-hidden text-ellipsis ${
            status === "failed" ? "text-red-400" : ""
          }`}
          title={displayName}
        >
          {middleTruncate(displayName, 40)}
        </p>
      </div>
      <div className="col-span-5 flex justify-end items-center gap-x-2">
        {isEmbedding ? (
          <div className="flex items-center gap-x-2 w-full justify-end">
            <div className="w-20 h-[1.5px] bg-white/10 light:bg-sky-900/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-white light:bg-sky-400 rounded-full transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-xs whitespace-nowrap w-8 text-right">{pct}%</p>
          </div>
        ) : (
          <div className="flex items-center gap-x-2">
            <p
              className={`text-xs italic whitespace-nowrap flex gap-2 justify-center items-center ${STATUS_STYLES[status]?.textColor}`}
            >
              {STATUS_STYLES[status]?.label || "Queued"}
            </p>
            {onRemove && (
              <button
                onClick={onRemove}
                className="border-none hover:bg-white/10 light:hover:bg-sky-900/10 rounded p-0.5 transition-colors"
                title="Remove from queue"
              >
                <X
                  size={14}
                  className="text-slate-100 light:text-slate-900/40 hover:text-slate-100 light:hover:text-slate-900"
                />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default memo(WorkspaceDirectory);
