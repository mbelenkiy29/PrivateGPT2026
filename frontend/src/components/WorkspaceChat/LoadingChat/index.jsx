import { useTranslation } from "react-i18next";
import LoadingState from "@/components/ui/21st/LoadingState";

export default function LoadingChat() {
  const { t } = useTranslation();
  return (
    <div
      className="transition-all duration-500 relative md:ml-[2px] md:mr-[16px] md:my-[16px] md:rounded-[16px] bg-theme-bg-secondary w-full h-full overflow-y-scroll no-scroll p-4 flex items-center justify-center"
      style={{ height: "calc(100% - 32px)" }}
    >
      <LoadingState variant="dots" label={t("common.loading")} size="page" />
    </div>
  );
}
