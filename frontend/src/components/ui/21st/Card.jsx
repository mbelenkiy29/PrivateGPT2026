import { cn } from "./cn";

/**
 * 21st.dev — card surface used by search results / settings groups.
 */
export default function Card({ title, description, children, className = "" }) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-theme-modal-border bg-theme-settings-input-bg/50 p-5 flex flex-col gap-3",
        className
      )}
    >
      {(title || description) && (
        <header className="flex flex-col gap-1">
          {title && (
            <h3 className="text-sm font-semibold text-theme-text-primary">
              {title}
            </h3>
          )}
          {description && (
            <div className="text-xs text-theme-text-secondary leading-relaxed">
              {description}
            </div>
          )}
        </header>
      )}
      {children}
    </section>
  );
}
