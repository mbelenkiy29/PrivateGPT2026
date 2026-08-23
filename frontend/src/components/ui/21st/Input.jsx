import { cn } from "./cn";

/**
 * 21st.dev — originui Input, mapped to PrivateGPT theme tokens.
 */
export default function Input({ className = "", type = "text", ...props }) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-lg border border-theme-modal-border bg-theme-settings-input-bg px-3 py-2 text-sm text-theme-text-primary shadow-sm transition-shadow placeholder:text-theme-settings-input-placeholder focus-visible:border-sky-500/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-sky-500/20 disabled:cursor-not-allowed disabled:opacity-50",
        type === "search" &&
          "[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none",
        className
      )}
      {...props}
    />
  );
}
