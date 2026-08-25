import { memo, useState } from "react";
import { formatDateTimeAsMoment, getFileExtension } from "@/utils/directories";
import { ArrowUUpLeft, Eye, PushPin } from "@phosphor-icons/react";
import FileTreeRow from "@/components/ui/21st/FileTreeRow";
import Workspace from "@/models/workspace";
import showToast from "@/utils/toast";
import System from "@/models/system";

export default function WorkspaceFileRow({
  item,
  folderName,
  workspace,
  setLoading,
  setLoadingMessage,
  fetchKeys,
  hasChanges,
  movedItems,
  selected,
  toggleSelection,
  disableSelection,
  setSelectedItems,
}) {
  const onRemoveClick = async (e) => {
    e.stopPropagation();
    setLoading(true);

    try {
      setLoadingMessage(`Removing file from workspace`);
      await Workspace.modifyEmbeddings(workspace.slug, {
        adds: [],
        deletes: [`${folderName}/${item.name}`],
      });
      await fetchKeys(true);
    } catch (error) {
      console.error("Failed to remove document:", error);
    }
    setSelectedItems({});
    setLoadingMessage("");
    setLoading(false);
  };

  const isMovedItem = movedItems?.some((movedItem) => movedItem.id === item.id);
  return (
    <FileTreeRow
      type="file"
      name={item.title}
      selected={!!selected || isMovedItem}
      disabled={disableSelection}
      onToggle={disableSelection ? undefined : toggleSelection}
      data-tooltip-id="ws-directory-item"
      data-tooltip-content={JSON.stringify({
        title: item.title,
        date: formatDateTimeAsMoment(item?.published),
        extension: getFileExtension(item.url),
      })}
      trailing={
        hasChanges ? null : (
          <>
            <WatchForChanges
              workspace={workspace}
              docPath={`${folderName}/${item.name}`}
              item={item}
            />
            <PinItemToWorkspace
              workspace={workspace}
              docPath={`${folderName}/${item.name}`}
              item={item}
            />
            <RemoveItemFromWorkspace item={item} onClick={onRemoveClick} />
          </>
        )
      }
    />
  );
}

const PinItemToWorkspace = memo(({ workspace, docPath, item }) => {
  const [pinned, setPinned] = useState(
    item?.pinnedWorkspaces?.includes(workspace.id) || false
  );
  const pinEvent = new CustomEvent("pinned_document");

  const updatePinStatus = async (e) => {
    try {
      e.stopPropagation();
      if (!pinned) window.dispatchEvent(pinEvent);
      const success = await Workspace.setPinForDocument(
        workspace.slug,
        docPath,
        !pinned
      );

      if (!success) {
        showToast(`Failed to ${!pinned ? "pin" : "unpin"} document.`, "error", {
          clear: true,
        });
        return;
      }

      showToast(
        `Document ${!pinned ? "pinned to" : "unpinned from"} workspace`,
        "success",
        { clear: true }
      );
      setPinned(!pinned);
    } catch (error) {
      showToast(`Failed to pin document. ${error.message}`, "error", {
        clear: true,
      });
      return;
    }
  };

  if (!item) return <div className="w-[16px] p-[2px] ml-2" />;

  return (
    <div
      onClick={updatePinStatus}
      className="group flex items-center ml-2 cursor-pointer"
      data-tooltip-id="pin-document"
      data-tooltip-content={
        pinned ? "Un-pin from workspace" : "Pin to workspace"
      }
    >
      {pinned ? (
        <div className="bg-theme-settings-input-active group-hover:bg-red-500/20 rounded-3xl whitespace-nowrap">
          <p className="text-xs px-2 py-0.5 group-hover:text-red-500">
            <span className="group-hover:hidden">Pinned</span>
            <span className="hidden group-hover:inline">Un-pin</span>
          </p>
        </div>
      ) : (
        <PushPin
          size={16}
          weight="regular"
          className="outline-none text-base font-bold flex-shrink-0"
        />
      )}
    </div>
  );
});

const WatchForChanges = memo(({ workspace, docPath, item }) => {
  const [watched, setWatched] = useState(item?.watched || false);
  const watchEvent = new CustomEvent("watch_document_for_changes");

  const updateWatchStatus = async (e) => {
    try {
      e.stopPropagation();
      if (!watched) window.dispatchEvent(watchEvent);
      const success =
        await System.experimentalFeatures.liveSync.setWatchStatusForDocument(
          workspace.slug,
          docPath,
          !watched
        );

      if (!success) {
        showToast(
          `Failed to ${!watched ? "watch" : "unwatch"} document.`,
          "error",
          {
            clear: true,
          }
        );
        return;
      }

      showToast(
        `Document ${
          !watched
            ? "will be watched for changes"
            : "will no longer be watched for changes"
        }.`,
        "success",
        { clear: true }
      );
      setWatched(!watched);
    } catch (error) {
      showToast(`Failed to watch document. ${error.message}`, "error", {
        clear: true,
      });
      return;
    }
  };

  if (!item || !item.canWatch) return <div className="w-[16px] p-[2px] ml-2" />;

  return (
    <div
      className="group flex gap-x-2 items-center hover:bg-theme-file-picker-hover p-[2px] rounded ml-2 cursor-pointer"
      onClick={updateWatchStatus}
      data-tooltip-id="watch-changes"
      data-active={watched}
      data-tooltip-content={
        watched ? "Stop watching for changes" : "Watch document for changes"
      }
    >
      <Eye
        size={16}
        weight="regular"
        className="outline-none text-base font-bold flex-shrink-0 group-hover:hidden group-data-[active=true]:hidden"
      />
      <Eye
        size={16}
        weight="fill"
        className="outline-none text-base font-bold flex-shrink-0 hidden group-hover:block group-data-[active=true]:block"
      />
    </div>
  );
});

const RemoveItemFromWorkspace = ({ item: _item, onClick }) => {
  return (
    <div>
      <ArrowUUpLeft
        data-tooltip-id="remove-document"
        data-tooltip-content="Remove document from workspace"
        onClick={onClick}
        className="text-base font-bold w-4 h-4 ml-2 flex-shrink-0 cursor-pointer"
      />
    </div>
  );
};
