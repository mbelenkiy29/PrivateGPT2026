import { useEffect, useState } from "react";
import { cn } from "./cn";

const chevron = Array.from({ length: 9 }, (_, i) => {
  const r = Math.floor(i / 3);
  const c = i % 3;
  return (c + Math.abs(r - 1)) * 90;
});

const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3];
const orbit = Array.from({ length: 9 }, (_, i) => {
  const k = ORBIT_ORDER.indexOf(i);
  return k === -1 ? null : k * 110;
});

const PATTERNS = {
  drive: { delays: chevron, dur: 650, round: false },
  dots: { delays: chevron, dur: 650, round: true },
  orbit: { delays: orbit, dur: 950, round: false },
};

function useElapsed() {
  const [ds, setDs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setDs((d) => d + 1), 100);
    return () => clearInterval(t);
  }, []);
  const total = ds / 10;
  if (total < 60) return `${total.toFixed(1)}s`;
  return `${Math.floor(total / 60)}m ${(total % 60).toFixed(1)}s`;
}

/**
 * 21st.dev pixel-grid loader, mapped to PrivateGPT theme tokens
 * and Plus Jakarta Sans. Variants: drive | dots | orbit.
 */
export default function LoadingState({
  label = "Loading",
  variant = "drive",
  showTimer = true,
  size = "default",
  className = "",
}) {
  const elapsed = useElapsed();
  const patternKey = String(variant || "drive").toLowerCase();
  const { delays, dur, round } = PATTERNS[patternKey] ?? PATTERNS.drive;
  const gridOnly = size === "grid";
  const isPage = size === "page";

  const grid = (
    <span aria-hidden className="grid grid-cols-[repeat(3,4px)] gap-[1.5px]">
      {delays.map((d, i) => (
        <span
          key={i}
          className={cn(
            "loading-state-cell size-[4px] bg-theme-text-primary",
            round ? "rounded-full" : "rounded-[1px]"
          )}
          style={{
            opacity: d === null ? 0.07 : 0.15,
            animation:
              d === null
                ? "none"
                : `pixel-on ${dur}ms ease-in-out ${d}ms infinite`,
          }}
        />
      ))}
    </span>
  );

  if (gridOnly) {
    return (
      <span
        className={cn("inline-flex items-center justify-center", className)}
        role="status"
      >
        {grid}
        {label ? <span className="sr-only">{label}</span> : null}
      </span>
    );
  }

  const row = (
    <div className="flex w-fit items-center gap-2.5">
      {grid}
      {label ? (
        <span
          role="status"
          className="loading-state-label bg-clip-text text-sm font-medium text-transparent"
          style={{
            backgroundImage:
              "linear-gradient(90deg, var(--theme-text-secondary) 35%, var(--theme-text-primary) 50%, var(--theme-text-secondary) 65%)",
            backgroundSize: "200% 100%",
            animation: "shimmer-text 1.4s linear infinite",
          }}
        >
          {label}
        </span>
      ) : null}
      {showTimer ? (
        <span
          aria-hidden="true"
          className="text-xs text-theme-text-secondary tabular-nums"
        >
          {elapsed}
        </span>
      ) : null}
    </div>
  );

  if (isPage) {
    return (
      <div
        className={cn(
          "flex w-full flex-1 min-h-[160px] items-center justify-center p-8",
          className
        )}
      >
        {row}
      </div>
    );
  }

  return <div className={cn("w-fit", className)}>{row}</div>;
}
