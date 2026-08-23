import { useTranslation } from "react-i18next";
import {
  Headset,
  BookOpen,
  Briefcase,
  Receipt,
  Scales,
  FirstAid,
} from "@phosphor-icons/react";

const KIT_ICONS = {
  "customer-support": Headset,
  "employee-handbook": BookOpen,
  "sales-proposals": Briefcase,
  "invoice-qa": Receipt,
  "legal-lite": Scales,
  "clinic-sops": FirstAid,
};

export default function StarterKitCards({
  kits = [],
  installingId = null,
  onSelect,
}) {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full">
      {kits.map((kit) => {
        const Icon = KIT_ICONS[kit.id] || BookOpen;
        const busy = installingId === kit.id;
        const name = t(`onboarding.starterKit.kits.${kit.id}.name`, {
          defaultValue: kit.name,
        });
        const description = t(
          `onboarding.starterKit.kits.${kit.id}.description`,
          { defaultValue: kit.description }
        );

        return (
          <button
            key={kit.id}
            type="button"
            disabled={!!installingId}
            onClick={() => onSelect(kit)}
            className={`text-left rounded-xl border-2 p-4 flex flex-col gap-y-2 transition-all duration-200 ${
              busy
                ? "border-sky-400/70 bg-theme-bg-secondary"
                : "border-theme-sidebar-border hover:border-sky-400/70 hover:bg-theme-bg-secondary"
            } disabled:opacity-60 disabled:cursor-not-allowed`}
          >
            <div className="flex items-center gap-x-2">
              <Icon
                size={20}
                className="text-theme-text-primary shrink-0"
                weight="duotone"
              />
              <div className="text-theme-text-primary text-sm font-semibold">
                {name}
              </div>
            </div>
            <p className="text-theme-text-secondary text-xs leading-relaxed">
              {description}
            </p>
            <span className="text-sky-400 text-xs font-medium mt-auto">
              {busy
                ? t("onboarding.starterKit.installing")
                : t("onboarding.starterKit.install")}
            </span>
          </button>
        );
      })}
    </div>
  );
}
