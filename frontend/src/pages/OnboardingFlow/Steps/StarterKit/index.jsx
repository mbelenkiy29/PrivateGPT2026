import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import paths from "@/utils/paths";
import Workspace from "@/models/workspace";
import showToast from "@/utils/toast";
import StarterKitCards from "@/components/StarterKitCards";
import {
  firstSuggestedQuestion,
  readStarterKitOnboarding,
  rememberStarterKitOnboarding,
} from "@/utils/starterKit";

export default function StarterKitStep({
  setHeader,
  setForwardBtn,
  setBackBtn,
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [kits, setKits] = useState([]);
  const [installingId, setInstallingId] = useState(null);
  const [installedKitId, setInstalledKitId] = useState(
    () => readStarterKitOnboarding()?.kitId || null
  );

  const TITLE = t("onboarding.starterKit.title");
  const DESCRIPTION = t("onboarding.starterKit.description");

  useEffect(() => {
    setHeader({ title: TITLE, description: DESCRIPTION });
    setForwardBtn({
      showing: true,
      disabled: !!installingId,
      onClick: handleSkip,
    });
    setBackBtn({ showing: true, disabled: false, onClick: handleBack });
  }, [TITLE, DESCRIPTION, installingId, installedKitId]);

  useEffect(() => {
    Workspace.starterKits().then(setKits);
  }, []);

  function handleBack() {
    navigate(paths.onboarding.llmPreference());
  }

  function handleSkip() {
    if (readStarterKitOnboarding()?.slug) {
      navigate(paths.onboarding.connectDrive());
      return;
    }
    navigate(paths.onboarding.userSetup());
  }

  async function handleSelect(kit) {
    if (installingId) return;
    const existing = readStarterKitOnboarding();
    if (existing?.slug) {
      navigate(paths.onboarding.connectDrive());
      return;
    }

    setInstallingId(kit.id);
    const {
      workspace,
      kit: installed,
      message,
    } = await Workspace.installKit(kit.id);
    if (!workspace) {
      setInstallingId(null);
      showToast(message || t("onboarding.starterKit.error"), "error");
      return;
    }
    if (message) showToast(message, "error");

    rememberStarterKitOnboarding({
      slug: workspace.slug,
      kitId: kit.id,
      firstQuestion: firstSuggestedQuestion(installed || kit),
    });
    setInstalledKitId(kit.id);
    setInstallingId(null);
    navigate(paths.onboarding.connectDrive());
  }

  return (
    <div className="w-full flex flex-col items-center gap-y-4">
      {installedKitId && (
        <p className="text-theme-text-secondary text-xs text-center max-w-[600px]">
          {t("onboarding.starterKit.alreadyInstalled")}
        </p>
      )}
      <StarterKitCards
        kits={kits}
        installingId={installingId}
        installedKitId={installedKitId}
        onSelect={handleSelect}
      />
      <button
        type="button"
        onClick={handleSkip}
        disabled={!!installingId}
        className="text-theme-text-secondary text-sm font-medium hover:text-theme-text-primary disabled:opacity-50"
      >
        {installedKitId
          ? t("onboarding.starterKit.continue")
          : t("onboarding.starterKit.skip")}
      </button>
    </div>
  );
}
