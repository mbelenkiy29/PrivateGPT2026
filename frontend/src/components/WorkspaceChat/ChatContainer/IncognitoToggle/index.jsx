import { Detective } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";

export default function IncognitoToggle({
  active = false,
  onToggle,
  disabled = false,
}) {
  const { t } = useTranslation();
  const label = active
    ? t("chat_window.incognito_disable")
    : t("chat_window.incognito_enable");

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={active}
      aria-label={label}
      title={t("chat_window.incognito_tooltip")}
      data-tooltip-id="incognito-toggle"
      data-tooltip-content={t("chat_window.incognito_tooltip")}
      className={`group border-none cursor-pointer flex items-center justify-center w-[35px] h-[35px] rounded-full transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
        active
          ? "bg-zinc-700 light:bg-slate-200"
          : "hover:bg-zinc-700 light:hover:bg-slate-200"
      }`}
    >
      <Detective
        size={18}
        weight={active ? "fill" : "regular"}
        className={
          active
            ? "text-white light:text-slate-800"
            : "text-zinc-300 light:text-slate-600 group-hover:text-white light:group-hover:text-slate-800"
        }
      />
    </button>
  );
}

export function IncognitoBanner({ visible = false }) {
  const { t } = useTranslation();
  if (!visible) return null;

  return (
    <div
      role="status"
      className="pointer-events-none absolute top-2.5 left-1/2 z-20 -translate-x-1/2 max-w-[min(90%,22rem)]"
    >
      <p className="rounded-full bg-zinc-800/90 light:bg-slate-100/95 px-3 py-1 text-center text-xs font-medium text-theme-text-secondary light:text-slate-600">
        {t("chat_window.incognito_banner")}
      </p>
    </div>
  );
}
