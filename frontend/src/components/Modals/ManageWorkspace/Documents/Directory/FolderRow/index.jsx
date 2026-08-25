import { useState } from "react";
import FileRow from "../FileRow";
import { useTranslation } from "react-i18next";
import FileTreeRow from "@/components/ui/21st/FileTreeRow";
import LoadingState from "@/components/ui/21st/LoadingState";

/**
 * A folder in the document picker. Purely presentational - every piece of
 * state (which files are loaded, whether it is open, what is selected) is
 * owned by `useDocumentPicker` so the row can never drift out of sync with
 * the rest of the picker.
 */
export default function FolderRow({
  item,
  files = [],
  expanded = false,
  loading = false,
  hasMore = false,
  totalCount = 0,
  displayCount = 0,
  selectionState = "none",
  isFileSelected,
  onToggleExpanded,
  onToggleFolder,
  onToggleFile,
  onPrefetch,
  onLoadMore,
  acceptsDrops = false,
  onDropFiles,
}) {
  const { t } = useTranslation();
  const [isDropTarget, setIsDropTarget] = useState(false);
  const selected = selectionState === "all";
  const partial = selectionState === "some";

  const dragHasFiles = (event) =>
    Array.from(event.dataTransfer?.types ?? []).includes("Files");

  const handleDragOver = (event) => {
    if (!acceptsDrops || !dragHasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    if (!isDropTarget) setIsDropTarget(true);
  };

  const handleDragLeave = (event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setIsDropTarget(false);
  };

  const handleDrop = (event) => {
    setIsDropTarget(false);
    if (!acceptsDrops || !dragHasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    onDropFiles(item.name, event);
  };

  return (
    <>
      <FileTreeRow
        type="folder"
        name={item.name}
        selected={selected}
        partial={partial}
        expanded={expanded}
        dropActive={isDropTarget}
        meta={displayCount > 0 ? String(displayCount) : undefined}
        badge={
          loading && files.length > 0 ? (
            <LoadingState size="grid" variant="drive" />
          ) : null
        }
        onToggle={() => onToggleFolder(item)}
        onActivate={() => onToggleExpanded(item.name)}
        onMouseEnter={() => onPrefetch(item.name)}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      />
      {expanded && loading && files.length === 0 && (
        <div className="flex items-center gap-2 py-2 pl-10 text-xs text-theme-text-secondary">
          <LoadingState size="grid" variant="drive" />
          <span>{t("common.loading")}...</span>
        </div>
      )}
      {expanded &&
        files.map((file) => (
          <FileRow
            key={file.id}
            item={file}
            selected={isFileSelected(file.id)}
            folderName={item.name}
            toggleSelection={onToggleFile}
          />
        ))}
      {expanded && hasMore && (
        <div className="py-1 pl-10">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onLoadMore(item.name);
            }}
            disabled={loading}
            className="border-none bg-transparent text-xs text-theme-text-secondary hover:text-theme-text-primary cursor-pointer underline disabled:opacity-50 p-0"
          >
            {loading
              ? `${t("common.loading")}...`
              : `Load more (${files.length} of ${totalCount})`}
          </button>
        </div>
      )}
    </>
  );
}
