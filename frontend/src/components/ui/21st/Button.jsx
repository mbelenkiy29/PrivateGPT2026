import { cn } from "./cn";
import LoadingState from "./LoadingState";

/**
 * 21st.dev — originui Button + shugar rounded shape, mapped to
 * PrivateGPT theme tokens. No extra UI kit required.
 */
const VARIANTS = {
  primary:
    "bg-theme-text-primary text-theme-bg-primary shadow-sm hover:opacity-90",
  outline:
    "border border-theme-modal-border bg-theme-bg-primary text-theme-text-primary hover:shadow-md",
  secondary:
    "border border-theme-modal-border bg-theme-settings-input-bg text-theme-text-primary hover:bg-theme-file-picker-hover",
  ghost:
    "border-none bg-transparent text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-file-picker-hover",
  destructive: "border-none bg-red-600/90 text-white hover:bg-red-600",
};

const SIZES = {
  sm: "h-8 px-3 text-xs gap-1.5",
  default: "h-9 px-4 text-sm gap-2",
  lg: "h-10 px-5 text-sm gap-2",
  icon: "h-8 w-8 p-0",
};

export default function Button({
  variant = "primary",
  size = "default",
  className = "",
  type = "button",
  loading = false,
  disabled = false,
  children,
  ...props
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-full font-semibold transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-sky-500/25 disabled:pointer-events-none disabled:opacity-50",
        VARIANTS[variant] || VARIANTS.primary,
        SIZES[size] || SIZES.default,
        className
      )}
      {...props}
    >
      {loading ? (
        <LoadingState size="grid" variant="drive" label="Loading" />
      ) : null}
      {children}
    </button>
  );
}
