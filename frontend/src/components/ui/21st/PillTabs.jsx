import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 21st.dev — Pill Morph Tabs (ruixen.ui / reshaped pills), adapted to
 * PrivateGPT theme tokens. No extra UI kit required.
 */
export default function PillTabs({
  items = [],
  value,
  onChange,
  className = "",
  size = "sm",
}) {
  const listRef = useRef(null);
  const triggerRefs = useRef({});
  const [indicator, setIndicator] = useState({ left: 4, width: 0 });

  const measure = useCallback(() => {
    const list = listRef.current;
    const active = triggerRefs.current[value];
    if (!list || !active) return;
    const listRect = list.getBoundingClientRect();
    const tRect = active.getBoundingClientRect();
    setIndicator({
      left: tRect.left - listRect.left + list.scrollLeft,
      width: tRect.width,
    });
  }, [value]);

  useEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (listRef.current) ro.observe(listRef.current);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure, items.length]);

  const pad = size === "sm" ? "px-3 py-1" : "px-4 py-1.5";
  const text = size === "sm" ? "text-xs" : "text-sm";

  return (
    <div
      ref={listRef}
      className={`relative flex items-center gap-0.5 p-0.5 rounded-full border border-theme-modal-border ${className}`}
      style={{
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.00))",
      }}
      role="tablist"
    >
      {indicator.width > 0 && (
        <span
          aria-hidden
          className="absolute top-0.5 bottom-0.5 rounded-full pointer-events-none transition-all duration-300 ease-out"
          style={{
            left: indicator.left,
            width: indicator.width,
            background:
              "linear-gradient(90deg, rgba(14,165,233,0.22), rgba(99,102,241,0.16))",
            boxShadow: "0 4px 14px rgba(15,23,42,0.08)",
          }}
        />
      )}
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            ref={(el) => {
              triggerRefs.current[item.value] = el;
            }}
            onClick={() => onChange?.(item.value)}
            className={`relative z-10 border-none bg-transparent rounded-full ${pad} ${text} font-semibold inline-flex items-center justify-center gap-1.5 transition-colors ${
              active
                ? "text-theme-text-primary light:text-sky-800"
                : "text-theme-text-secondary hover:text-theme-text-primary"
            }`}
          >
            {item.icon}
            <span className="truncate">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
