import { cn } from "./cn";

/**
 * 21st.dev — Scroll Area File Explorer (ephraimduncan / 18106)
 * card chrome: header, sticky columns, scroll body, footer.
 */
export default function ExplorerPanel({
  title,
  description,
  actions,
  columnLabels,
  footer,
  highlight = false,
  className = "",
  bodyClassName = "",
  children,
}) {
  return (
    <section
      className={cn(
        "flex flex-col w-full overflow-hidden rounded-xl border border-theme-modal-border bg-theme-bg-primary shadow-sm",
        highlight && "ring-2 ring-sky-400/60",
        className
      )}
    >
      <header className="flex items-center justify-between gap-2 flex-wrap border-b border-theme-modal-border bg-theme-bg-secondary/50 px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-theme-text-primary truncate">
            {title}
          </p>
          {description ? (
            <p className="text-[11px] text-theme-text-secondary truncate">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex items-center gap-1.5 shrink-0">{actions}</div>
        ) : null}
      </header>

      {columnLabels ? (
        <div className="sticky top-0 z-10 grid grid-cols-[1fr_auto] items-center gap-2 border-b border-theme-modal-border bg-theme-bg-primary/90 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-theme-text-secondary">
          {columnLabels}
        </div>
      ) : null}

      <div
        className={cn(
          "min-h-[280px] max-h-[320px] overflow-y-auto",
          bodyClassName
        )}
      >
        {children}
      </div>

      {footer ? (
        <footer className="border-t border-theme-modal-border bg-theme-bg-secondary/40 px-3 py-2">
          {footer}
        </footer>
      ) : null}
    </section>
  );
}
