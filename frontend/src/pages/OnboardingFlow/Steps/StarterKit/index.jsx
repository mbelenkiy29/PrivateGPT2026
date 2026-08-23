import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import paths from "@/utils/paths";
import Workspace from "@/models/workspace";
import showToast from "@/utils/toast";
import StarterKitCards from "@/components/StarterKitCards";
import {
  firstSuggestedQuestion,
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
  }, [TITLE, DESCRIPTION, installingId]);

  useEffect(() => {
    Workspace.starterKits().then(setKits);
  }, []);

  function handleBack() {
    navigate(paths.onboarding.llmPreference());
  }

  function handleSkip() {
    navigate(paths.onboarding.userSetup());
  }

  async function handleSelect(kit) {
    if (installingId) return;
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

    rememberStarterKitOnboarding({
      slug: workspace.slug,
      kitId: kit.id,
      firstQuestion: firstSuggestedQuestion(installed || kit),
    });
    navigate(paths.onboarding.connectDrive());
  }

  return (
    <div className="w-full flex flex-col items-center gap-y-4">
      <StarterKitCards
        kits={kits}
        installingId={installingId}
        onSelect={handleSelect}
      />
      <button
        type="button"
        onClick={handleSkip}
        disabled={!!installingId}
        className="text-theme-text-secondary text-sm font-medium hover:text-theme-text-primary disabled:opacity-50"
      >
        {t("onboarding.starterKit.skip")}
      </button>
    </div>
  );
}
