import { useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useTranslation } from "react-i18next";
import { Button, Dropzone, Field } from "@/components/ui/21st";
import Workspace from "@/models/workspace";
import System from "@/models/system";
import useLogo from "@/hooks/useLogo";
import { REFETCH_LOGO_EVENT } from "@/LogoContext";
import showToast from "@/utils/toast";
import { DEFAULT_WORKSPACE_NAME } from "./steps";

export default function WorkspaceStep({
  workspace,
  onWorkspaceChange,
  onSaved,
  defaultName,
}) {
  const { t } = useTranslation();
  const { logo, setLogo, isCustomLogo } = useLogo();
  const [name, setName] = useState(workspace?.name || "");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const placeholder = defaultName || DEFAULT_WORKSPACE_NAME;

  useEffect(() => {
    setName(workspace?.name || "");
  }, [workspace?.id, workspace?.slug, workspace?.name]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { "image/*": [] },
    maxFiles: 1,
    disabled: uploading,
    onDrop: async (files) => {
      const file = files?.[0];
      if (!file) return;
      setUploading(true);
      const formData = new FormData();
      formData.append("logo", file);
      const { success, error } = await System.uploadLogo(formData);
      if (!success) {
        showToast(error || t("gettingStarted.workspace.logoError"), "error");
        setUploading(false);
        return;
      }
      const { logoURL } = await System.fetchLogo();
      if (logoURL) setLogo(logoURL);
      window.dispatchEvent(new CustomEvent(REFETCH_LOGO_EVENT));
      showToast(t("gettingStarted.workspace.logoSaved"), "success", {
        clear: true,
      });
      setUploading(false);
    },
  });

  async function handleSave(e) {
    e.preventDefault();
    const nextName = name.trim();
    if (!nextName) {
      showToast(t("gettingStarted.workspace.nameRequired"), "error");
      return;
    }
    setSaving(true);
    if (workspace?.slug) {
      const { workspace: updated, message } = await Workspace.update(
        workspace.slug,
        { name: nextName }
      );
      if (!updated) {
        showToast(message || t("gettingStarted.workspace.saveError"), "error");
        setSaving(false);
        return;
      }
      onWorkspaceChange?.(updated);
    } else {
      const { workspace: created, message } = await Workspace.new({
        name: nextName,
      });
      if (!created) {
        showToast(message || t("gettingStarted.workspace.saveError"), "error");
        setSaving(false);
        return;
      }
      onWorkspaceChange?.(created);
    }
    onSaved?.();
    showToast(t("gettingStarted.workspace.saved"), "success", { clear: true });
    setSaving(false);
  }

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-3">
      <p className="text-xs text-theme-text-secondary leading-relaxed">
        {t("gettingStarted.workspace.description")}
      </p>
      <Field
        label={t("common.workspaces-name")}
        name="workspace-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        required
      />
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-theme-text-secondary">
          {t("gettingStarted.workspace.logo")}
        </span>
        {isCustomLogo && logo ? (
          <div className="flex items-center gap-3 rounded-xl border border-theme-modal-border bg-theme-bg-primary px-3 py-2">
            <img
              src={logo}
              alt=""
              className="h-8 w-auto max-w-[120px] object-contain"
            />
            <p className="text-xs text-theme-text-secondary">
              {t("gettingStarted.workspace.logoSet")}
            </p>
          </div>
        ) : null}
        <Dropzone
          getRootProps={getRootProps}
          getInputProps={getInputProps}
          isDragActive={isDragActive}
          ready={!uploading}
          empty
          compact
          title={
            uploading
              ? t("gettingStarted.workspace.logoUploading")
              : t("gettingStarted.workspace.logoAdd")
          }
          description={t("gettingStarted.workspace.logoHint")}
        />
      </div>
      <div>
        <Button type="submit" size="sm" loading={saving}>
          {workspace?.slug
            ? t("gettingStarted.workspace.save")
            : t("gettingStarted.workspace.create")}
        </Button>
      </div>
    </form>
  );
}
