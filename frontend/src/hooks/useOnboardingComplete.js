import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import System from "@/models/system";
import paths from "@/utils/paths";
import { STARTER_KIT_ONBOARDING } from "@/utils/constants";

export default function useRedirectToHomeOnOnboardingComplete() {
  const navigate = useNavigate();
  useEffect(() => {
    async function checkOnboardingComplete() {
      // Kit wizard continues after LLM marks onboarding complete.
      if (sessionStorage.getItem(STARTER_KIT_ONBOARDING)) return;
      const onboardingComplete = await System.isOnboardingComplete();
      if (onboardingComplete === false) return;
      navigate(paths.home());
    }
    checkOnboardingComplete();
  }, []);
}
