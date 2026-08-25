import { MagnifyingGlass } from "@phosphor-icons/react";
import Input from "./Input";
import { cn } from "./cn";
import LoadingState from "./LoadingState";

/**
 * 21st.dev — Search Bar (santoshvarmaaddala) + originui Input,
 * composed as a compact search field with a leading icon.
 */
export default function SearchInput({
  loading = false,
  className = "",
  inputClassName = "",
  ...props
}) {
  return (
    <div className={cn("relative", className)}>
      {loading ? (
        <span className="absolute left-3 top-1/2 -translate-y-1/2">
          <LoadingState size="grid" variant="orbit" label="Searching" />
        </span>
      ) : (
        <MagnifyingGlass
          size={14}
          weight="bold"
          className="absolute left-3 top-1/2 -translate-y-1/2 text-theme-text-secondary"
        />
      )}
      <Input
        type="search"
        className={cn("h-8 pl-9 rounded-full", inputClassName)}
        {...props}
      />
    </div>
  );
}
