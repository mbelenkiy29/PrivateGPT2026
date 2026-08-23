import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  GoogleLogo,
  FolderNotch,
  CaretRight,
  CheckCircle,
} from "@phosphor-icons/react";
import paths from "@/utils/paths";
import FileSources from "@/models/fileSources";
import showToast from "@/utils/toast";
import { readStarterKitOnboarding } from "@/utils/starterKit";

export default function ConnectDrive({ setHeader, setForwardBtn, setBackBtn }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [status, setStatus] = useState({
    connected: false,
    configured: false,
    loading: true,
    source: null,
  });
  const [connecting, setConnecting] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [parentStack, setParentStack] = useState([
    { id: "root", name: "Drive" },
  ]);
  const [items, setItems] = useState([]);
  const [listing, setListing] = useState(false);
  const [selected, setSelected] = useState(null);

  const TITLE = t("onboarding.connectDrive.title");
  const DESCRIPTION = t("onboarding.connectDrive.description");
  const landing = readStarterKitOnboarding();

  useEffect(() => {
    setHeader({ title: TITLE, description: DESCRIPTION });
    setForwardBtn({
      showing: true,
      disabled: false,
      onClick: goNext,
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
      source: drive.connected ? drive : null,
    });
    if (drive.connected && drive.id) loadFolder(drive.id, "root");
  }

  async function loadFolder(sourceId, parentId) {
    setListing(true);
    const data = await FileSources.children(sourceId, parentId);
    if (data.error) showToast(data.error, "error", { clear: true });
    setItems((data.items || []).filter((item) => item.type === "folder"));
    setListing(false);
  }

  function handleBack() {
    navigate(paths.onboarding.starterKit());
  }

  function goNext() {
    navigate(paths.onboarding.userSetup());
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
    setParentStack([{ id: "root", name: "Drive" }]);
    setSelected(null);
    await refreshStatus();
  }

  function openFolder(item) {
    setSelected(item);
    setParentStack((stack) => [...stack, { id: item.id, name: item.name }]);
    if (status.source?.id) loadFolder(status.source.id, item.id);
  }

  function goTo(index) {
    const next = parentStack.slice(0, index + 1);
    setParentStack(next);
    setSelected(index === 0 ? null : next[next.length - 1]);
    if (status.source?.id)
      loadFolder(status.source.id, next[next.length - 1].id);
  }

  async function handleWatchFolder() {
    const folder = selected || parentStack[parentStack.length - 1];
    if (!folder?.id || folder.id === "root" || !status.source?.id) {
      showToast(t("onboarding.connectDrive.pickFolderHint"), "error");
      return;
    }
    if (!landing?.slug) {
      showToast(t("onboarding.starterKit.error"), "error");
      return;
    }
    setIndexing(true);
    const result = await FileSources.index(status.source.id, {
      fileIds: [folder.id],
      workspaceSlug: landing.slug,
    });
    setIndexing(false);
    if (!result.success) {
      showToast(
        result.error || t("onboarding.connectDrive.indexError"),
        "error"
      );
      return;
    }
    showToast(t("onboarding.connectDrive.indexed"), "success");
    goNext();
  }

  const currentFolder = parentStack[parentStack.length - 1];
  const canWatch = currentFolder?.id && currentFolder.id !== "root";

  return (
    <div className="w-full flex flex-col items-center gap-y-6">
      <div className="flex flex-col border rounded-lg border-white/20 light:border-theme-sidebar-border p-8 items-center gap-y-4 w-full max-w-[600px]">
        {status.connected ? (
          <>
            <CheckCircle size={36} className="text-green-500" />
            <p className="text-theme-text-primary text-sm font-semibold text-center">
              {t("onboarding.connectDrive.connected")}
            </p>
            <p className="text-theme-text-secondary text-xs text-center">
              {t("onboarding.connectDrive.pickFolder")}
            </p>
            <div className="flex flex-wrap gap-1 w-full text-xs text-theme-text-secondary">
              {parentStack.map((crumb, index) => (
                <button
                  key={`${crumb.id}-${index}`}
                  type="button"
                  onClick={() => goTo(index)}
                  className="hover:text-theme-text-primary"
                >
                  {crumb.name}
                  {index < parentStack.length - 1 ? " / " : ""}
                </button>
              ))}
            </div>
            <div className="w-full max-h-[220px] overflow-y-auto flex flex-col gap-y-1">
              {listing && (
                <p className="text-theme-text-secondary text-xs">
                  {t("common.loading")}
                </p>
              )}
              {!listing && items.length === 0 && (
                <p className="text-theme-text-secondary text-xs">
                  {t("onboarding.connectDrive.noFolders")}
                </p>
              )}
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openFolder(item)}
                  className="flex items-center gap-x-2 w-full text-left px-2 py-2 rounded-lg hover:bg-theme-bg-secondary text-theme-text-primary text-sm"
                >
                  <FolderNotch size={16} className="shrink-0" />
                  <span className="truncate">{item.name}</span>
                  <CaretRight size={12} className="ml-auto opacity-50" />
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={!canWatch || indexing}
              onClick={handleWatchFolder}
              className="min-w-[230px] h-11 px-4 rounded-[10px] border-2 border-theme-sidebar-border text-theme-text-primary text-sm font-bold hover:border-sky-400/70 hover:text-sky-400 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {indexing
                ? t("onboarding.connectDrive.indexing")
                : t("onboarding.connectDrive.watchFolder")}
            </button>
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
      <p className="text-theme-text-secondary text-xs text-center max-w-[520px]">
        {t("onboarding.connectDrive.manageDocumentsHint")}
      </p>
      <button
        type="button"
        onClick={goNext}
        className="text-theme-text-secondary text-sm font-medium hover:text-theme-text-primary"
      >
        {t("onboarding.connectDrive.skip")}
      </button>
    </div>
  );
}
