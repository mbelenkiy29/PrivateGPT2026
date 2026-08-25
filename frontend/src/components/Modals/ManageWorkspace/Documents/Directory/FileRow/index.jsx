import React, { memo, useMemo } from "react";
import { formatDateTimeAsMoment, getFileExtension } from "@/utils/directories";
import FileTreeRow from "@/components/ui/21st/FileTreeRow";

function FileRow({ item, selected, folderName, toggleSelection }) {
  const tooltipContent = useMemo(
    () =>
      JSON.stringify({
        title: item.title,
        date: formatDateTimeAsMoment(item?.published),
        extension: getFileExtension(item.url),
      }),
    [item.title, item.published, item.url]
  );

  return (
    <FileTreeRow
      type="file"
      name={item.title}
      depth={1}
      selected={selected}
      onToggle={() => toggleSelection(item, folderName)}
      data-tooltip-id="directory-item"
      data-tooltip-content={tooltipContent}
      badge={
        item?.cached ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-theme-settings-input-active text-theme-text-secondary">
            Cached
          </span>
        ) : null
      }
    />
  );
}

export default memo(FileRow, (prev, next) => {
  return prev.item.id === next.item.id && prev.selected === next.selected;
});
