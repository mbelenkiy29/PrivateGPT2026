import { CaretRight } from "@phosphor-icons/react";
import { cn } from "./cn";

/**
 * 21st.dev — File Tree View (24877) + File Tree row (edwinvakayil),
 * restyled for PrivateGPT. Used by local, cloud, and workspace lists.
 */
export default function FileTreeRow({
  name,
  type = "file",
  selected = false,
  partial = false,
  expanded = false,
  depth = 0,
  meta,
  badge,
  disabled = false,
  dropActive = false,
  trailing,
  onToggle,
  onActivate,
  className = "",
  ...rest
}) {
  const isFolder = type === "folder";
  const checked = selected || partial;

  return (
    <div
      role="treeitem"
      aria-selected={selected}
      aria-expanded={isFolder ? expanded : undefined}
      onClick={() => {
        if (disabled) return;
        if (isFolder) onActivate?.();
        else onToggle?.();
      }}
      style={{ paddingLeft: 8 + depth * 14 }}
      className={cn(
        "group relative z-10 flex w-full items-center gap-2 py-1.5 pr-3 text-start text-xs text-theme-text-primary cursor-pointer",
        selected || partial
          ? "bg-sky-500/10 light:bg-sky-100/70"
          : "hover:bg-theme-file-picker-hover",
        dropActive &&
          "outline-dashed outline-2 -outline-offset-2 outline-sky-400 bg-sky-400/10",
        disabled && "cursor-default",
        className
      )}
      {...rest}
    >
      {onToggle ? (
        <span
          role="checkbox"
          aria-checked={partial ? "mixed" : selected}
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            if (!disabled) onToggle();
          }}
          onKeyDown={(e) => {
            if (e.key === " " || e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              if (!disabled) onToggle();
            }
          }}
          className={cn(
            "shrink-0 w-3.5 h-3.5 rounded-[4px] border flex items-center justify-center",
            checked
              ? "bg-sky-500 border-sky-500"
              : "border-theme-modal-border bg-theme-bg-primary"
          )}
        >
          {selected && (
            <span className="block w-1.5 h-1.5 rounded-[1px] bg-white" />
          )}
          {partial && !selected && (
            <span className="block w-1.5 h-[2px] rounded-[1px] bg-white" />
          )}
        </span>
      ) : (
        <span className="shrink-0 w-3.5" />
      )}

      {isFolder ? (
        <CaretRight
          size={12}
          className={cn(
            "shrink-0 text-theme-text-secondary transition-transform",
            expanded && "rotate-90"
          )}
        />
      ) : null}

      <span
        className={cn(
          "shrink-0 w-4 h-4 rounded-[4px] flex items-center justify-center",
          isFolder
            ? "bg-amber-400/20 text-amber-500 light:text-amber-700"
            : "bg-sky-500/10 text-sky-500"
        )}
      >
        {isFolder ? (
          <svg viewBox="0 0 16 16" className="w-3 h-3" fill="currentColor">
            <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h3.38c.4 0 .78.16 1.06.44L9 3.5h3.5A1.5 1.5 0 0 1 14 5v6.5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5v-8Z" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" className="w-3 h-3" fill="currentColor">
            <path d="M4 1.5A1.5 1.5 0 0 0 2.5 3v10A1.5 1.5 0 0 0 4 14.5h8A1.5 1.5 0 0 0 13.5 13V6.12L9.88 2.5H4ZM9 3.06 12.44 6.5H9.5a.5.5 0 0 1-.5-.5V3.06Z" />
          </svg>
        )}
      </span>

      <span className="truncate flex-1 font-medium">{name}</span>
      {badge}
      {meta ? (
        <span className="shrink-0 text-[10px] text-theme-text-secondary">
          {meta}
        </span>
      ) : null}
      {trailing ? (
        <span
          className="shrink-0 ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          {trailing}
        </span>
      ) : null}
    </div>
  );
}
