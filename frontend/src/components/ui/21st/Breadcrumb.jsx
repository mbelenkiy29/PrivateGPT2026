import { CaretRight, House } from "@phosphor-icons/react";
import { cn } from "./cn";

/**
 * 21st.dev — Pill Breadcrumb (shadcnspace), without shadcn primitives.
 */
export default function Breadcrumb({ items = [], onSelect, className = "" }) {
  return (
    <nav aria-label="breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-1 h-8 rounded-full border border-theme-modal-border px-2.5 text-xs text-theme-text-secondary overflow-x-auto">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li
              key={item.id || index}
              className="inline-flex items-center gap-1"
            >
              {index > 0 && (
                <CaretRight
                  size={12}
                  className="text-theme-text-secondary/70"
                />
              )}
              {last ? (
                <span className="text-theme-text-primary font-medium truncate max-w-[140px]">
                  {index === 0 ? <House size={13} /> : item.name}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => onSelect?.(index)}
                  className={cn(
                    "border-none bg-transparent p-0 text-theme-text-secondary hover:text-theme-text-primary truncate max-w-[140px]",
                    index === 0 && "inline-flex items-center"
                  )}
                >
                  {index === 0 ? <House size={13} /> : item.name}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
