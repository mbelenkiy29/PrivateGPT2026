import Input from "./Input";
import { cn } from "./cn";

/**
 * 21st.dev — shadcn Field + originui Input, as a labeled form control.
 */
export default function Field({ label, hint, className = "", ...inputProps }) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <span className="text-xs font-medium text-theme-text-secondary">
          {label}
        </span>
      )}
      <Input {...inputProps} />
      {hint && (
        <span className="text-[11px] text-theme-text-secondary leading-relaxed">
          {hint}
        </span>
      )}
    </label>
  );
}
