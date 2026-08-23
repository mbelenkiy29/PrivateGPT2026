import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { GoogleLogo, CheckCircle } from "@phosphor-icons/react";
import paths from "@/utils/paths";
import FileSources from "@/models/fileSources";
import showToast from "@/utils/toast";
import {
  consumeStarterKitOnboarding,
  queueStarterKitPrompt,
} from "@/utils/starterKit";

export default function ConnectDrive({ setHeader, setForwardBtn, setBackBtn }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [status, setStatus] = useState({
    connected: false,
    configured: false,
    loading: true,
  });
  const [connecting, setConnecting] = useState(false);

  const TITLE = t("onboarding.connectDrive.title");
  const DESCRIPTION = t("onboarding.connectDrive.description");

  useEffect(() => {
    setHeader({ title: TITLE, description: DESCRIPTION });
    setForwardBtn({
      showing: true,
      disabled: false,
      onClick: goToChat,
    });
    setBackBtn({ showing: true, disabled: false, onClick: handleBack });
  }, [TITLE, DESCRIPTION]);

  useEffect(() => {
    refreshStatus();
  }, []);

  async function refreshStatus() {
    const data = await FileSources.list();
    const drive = data?.sources?.["google-drive"] || {};
    setStatus({
      connected: !!drive.connected,
      configured: !!data?.oauth?.google?.configured,
      loading: false,
    });
  }

  function handleBack() {
    navigate(paths.onboarding.starterKit());
  }

  function goToChat() {
    const landing = consumeStarterKitOnboarding();
    if (landing?.firstQuestion) queueStarterKitPrompt(landing.firstQuestion);
    if (landing?.slug) {
      navigate(paths.workspace.chat(landing.slug));
      return;
    }
    navigate(paths.home());
  }

  async function handleConnect() {
    setConnecting(true);
    const result = await FileSources.connectPopup("google-drive");
    setConnecting(false);
    if (!result.success) {
      showToast(
        result.error || t("onboarding.connectDrive.connectError"),
        "error"
      );
      return;
    }
    showToast(t("onboarding.connectDrive.connected"), "success");
    await refreshStatus();
  }

  return (
    <div className="w-full flex flex-col items-center gap-y-6">
      <div className="flex flex-col border rounded-lg border-white/20 light:border-theme-sidebar-border p-8 items-center gap-y-4 w-full max-w-[600px]">
        {status.connected ? (
          <>
            <CheckCircle size={48} className="text-green-500" />
            <p className="text-theme-text-primary text-sm font-semibold text-center">
              {t("onboarding.connectDrive.connected")}
            </p>
          </>
        ) : (
          <>
            <GoogleLogo size={40} className="text-theme-text-primary" />
            <p className="text-theme-text-secondary text-sm text-center">
              {status.configured
                ? t("onboarding.connectDrive.later")
                : t("onboarding.connectDrive.needsCredentials")}
            </p>
            <button
              type="button"
              disabled={connecting || !status.configured || status.loading}
              onClick={handleConnect}
              className="min-w-[230px] h-11 px-4 rounded-[10px] border-2 border-theme-sidebar-border text-theme-text-primary text-sm font-bold hover:border-sky-400/70 hover:text-sky-400 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {connecting
                ? t("onboarding.connectDrive.connecting")
                : t("onboarding.connectDrive.connect")}
            </button>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={goToChat}
        className="text-theme-text-secondary text-sm font-medium hover:text-theme-text-primary"
      >
        {t("onboarding.connectDrive.skip")}
      </button>
    </div>
  );
}
