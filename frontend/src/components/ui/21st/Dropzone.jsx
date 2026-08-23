import { CloudArrowUp } from "@phosphor-icons/react";
import { cn } from "./cn";

/**
 * 21st.dev — joyco File Dropzone, adapted to wrap react-dropzone
 * without adding extra upload libraries.
 */
export default function Dropzone({
  getRootProps,
  getInputProps,
  ready = true,
  isDragActive = false,
  empty = true,
  title,
  description,
  compact = false,
  children,
  className = "",
}) {
  return (
    <div
      {...getRootProps?.()}
      data-dragging={isDragActive || undefined}
      className={cn(
        "relative flex flex-col items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-theme-modal-border bg-theme-bg-primary transition-colors duration-300",
        compact ? "p-2" : "p-4",
        ready
          ? "cursor-pointer hover:border-sky-400/50 hover:bg-theme-bg-secondary light:hover:bg-[#E0F2FE]"
          : "cursor-not-allowed opacity-70",
        isDragActive && "border-sky-400 bg-sky-500/10",
        className
      )}
    >
      {getInputProps ? <input {...getInputProps()} /> : null}
      {empty ? (
        <div
          className={cn(
            "flex items-center text-center",
            compact
              ? "flex-row gap-3 px-2 py-1"
              : "flex-col justify-center px-4 py-3"
          )}
        >
          <span
            className={cn(
              "flex shrink-0 items-center justify-center rounded-full border border-theme-modal-border bg-theme-bg-primary",
              compact ? "size-8" : "size-11 mb-2"
            )}
          >
            <CloudArrowUp
              className={cn(
                "text-theme-text-secondary",
                compact ? "size-3.5" : "size-4"
              )}
              weight="bold"
            />
          </span>
          <div className={compact ? "text-left min-w-0" : ""}>
            <p className="text-sm font-semibold text-theme-text-primary">
              {title}
            </p>
            {description && (
              <p className="text-xs text-theme-text-secondary truncate max-w-[360px]">
                {description}
              </p>
            )}
          </div>
        </div>
      ) : (
        children
      )}
    </div>
  );
}
