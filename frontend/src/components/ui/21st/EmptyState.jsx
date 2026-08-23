import Button from "./Button";

/**
 * 21st.dev — Interactive Empty State (remcostoeten), simplified
 * for PrivateGPT without extra animation libraries.
 */
export default function EmptyState({
  title,
  description,
  icons = [],
  action,
  className = "",
}) {
  return (
    <section
      className={`group relative overflow-hidden text-center flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-theme-modal-border bg-theme-settings-input-bg/40 hover:border-sky-400/50 hover:bg-theme-settings-input-bg/70 transition-all duration-300 p-8 ${className}`}
    >
      {icons.length >= 3 && (
        <div className="flex justify-center isolate relative mb-5">
          <span className="w-11 h-11 -mr-2 mt-1 rounded-xl bg-theme-bg-primary border border-theme-modal-border shadow-sm flex items-center justify-center text-theme-text-secondary -rotate-6 group-hover:-rotate-12 group-hover:-translate-x-1 transition-transform duration-200 z-10">
            {icons[0]}
          </span>
          <span className="w-12 h-12 rounded-xl bg-theme-bg-primary border border-theme-modal-border shadow-md flex items-center justify-center text-theme-text-primary z-20 group-hover:-translate-y-1 transition-transform duration-200">
            {icons[1]}
          </span>
          <span className="w-11 h-11 -ml-2 mt-1 rounded-xl bg-theme-bg-primary border border-theme-modal-border shadow-sm flex items-center justify-center text-theme-text-secondary rotate-6 group-hover:rotate-12 group-hover:translate-x-1 transition-transform duration-200 z-10">
            {icons[2]}
          </span>
        </div>
      )}
      <h2 className="text-sm font-semibold text-theme-text-primary">{title}</h2>
      {description && (
        <p className="mt-1.5 text-xs text-theme-text-secondary max-w-[280px] leading-relaxed">
          {description}
        </p>
      )}
      {action && (
        <Button
          variant="outline"
          size="sm"
          className="mt-5"
          disabled={action.disabled}
          onClick={action.onClick}
        >
          {action.icon}
          {action.label}
        </Button>
      )}
      {action?.hint}
    </section>
  );
}
