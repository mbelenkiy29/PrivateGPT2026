import { useCallback, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { useTranslation } from "react-i18next";
import { Button, Card, Dropzone, Field } from "@/components/ui/21st";
import GettingStarted from "@/components/GettingStarted";
import UserOnboarding from "@/models/userOnboarding";
import System from "@/models/system";
import usePfp from "@/hooks/usePfp";
import useUser from "@/hooks/useUser";
import useLogo from "@/hooks/useLogo";
import { AUTH_USER } from "@/utils/constants";
import paths from "@/utils/paths";
import showToast from "@/utils/toast";
import { safeJsonParse } from "@/utils/request";

function persistUser(nextUser) {
  if (!nextUser) return;
  window.localStorage.setItem(AUTH_USER, JSON.stringify(nextUser));
}

export default function UserOnboardingPage() {
  const { t } = useTranslation();
  const { user } = useUser();
  const { pfp, setPfp } = usePfp();
  const { logo } = useLogo();
  const [status, setStatus] = useState(null);
  const [firstName, setFirstName] = useState(user?.firstName || "");
  const [lastName, setLastName] = useState(user?.lastName || "");
  const [workspace, setWorkspace] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const isAdmin = ["admin", "manager"].includes(user?.role);

  const load = useCallback(async () => {
    const next = await UserOnboarding.status();
    setStatus(next);
    if (next?.firstName) setFirstName(next.firstName);
    if (next?.lastName) setLastName(next.lastName);
    const firstWorkspace = next?.workspaces?.[0] || null;
    setWorkspace((current) => current || firstWorkspace);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { "image/*": [] },
    maxFiles: 1,
    disabled: uploading,
    onDrop: async (files) => {
      const file = files?.[0];
      if (!file) return;
      setUploading(true);
      const formData = new FormData();
      formData.append("file", file);
      const { success, error } = await System.uploadPfp(formData);
      if (!success) {
        showToast(error || t("userOnboarding.photoError"), "error");
        setUploading(false);
        return;
      }
      if (user?.id) {
        const url = await System.fetchPfp(user.id);
        setPfp(url);
      }
      showToast(t("userOnboarding.photoSaved"), "success", { clear: true });
      setUploading(false);
    },
  });

  async function handleFinish(e) {
    e?.preventDefault?.();
    setSaving(true);
    const {
      success,
      error,
      user: completed,
    } = await UserOnboarding.complete({
      firstName,
      lastName,
    });
    if (!success) {
      showToast(error || t("userOnboarding.completeError"), "error");
      await load();
      setSaving(false);
      return;
    }
    const stored = safeJsonParse(localStorage.getItem(AUTH_USER), user || {});
    persistUser({
      ...stored,
      ...(completed || {}),
      firstName,
      lastName,
      onboardingComplete: true,
    });
    showToast(t("userOnboarding.completeSuccess"), "success", { clear: true });
    window.location.assign(paths.home());
  }

  const namesReady = firstName.trim().length > 0 && lastName.trim().length > 0;
  const requirements = status?.requirements || {};
  const canFinish = isAdmin
    ? namesReady && requirements.workspace && requirements.invite
    : namesReady;
  const joinedName = status?.workspaces?.[0]?.name;

  return (
    <div className="w-screen min-h-screen overflow-y-auto bg-theme-bg-container flex justify-center py-10 px-4">
      <div className="w-full max-w-xl flex flex-col gap-6">
        {logo ? (
          <img
            src={logo}
            alt=""
            className="h-8 w-auto object-contain self-center"
          />
        ) : null}
        <div className="text-center">
          <h1 className="text-xl font-semibold text-theme-text-primary">
            {isAdmin
              ? t("userOnboarding.adminTitle")
              : t("userOnboarding.employeeTitle")}
          </h1>
          <p className="text-sm text-theme-text-secondary mt-1">
            {isAdmin
              ? t("userOnboarding.adminDescription")
              : t("userOnboarding.employeeDescription")}
          </p>
          {!isAdmin && joinedName ? (
            <p className="text-sm text-theme-text-primary mt-2">
              {t("userOnboarding.joining", { workspace: joinedName })}
            </p>
          ) : null}
        </div>

        <Card title={t("userOnboarding.profileTitle")}>
          <form className="flex flex-col gap-3" onSubmit={handleFinish}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field
                label={t("userOnboarding.firstName")}
                name="firstName"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                autoComplete="given-name"
              />
              <Field
                label={t("userOnboarding.lastName")}
                name="lastName"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                autoComplete="family-name"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-theme-text-secondary">
                {t("userOnboarding.photo")}
              </span>
              {pfp ? (
                <div className="flex items-center gap-3 rounded-xl border border-theme-modal-border bg-theme-bg-primary px-3 py-2">
                  <img
                    src={pfp}
                    alt=""
                    className="size-10 rounded-full object-cover"
                  />
                  <p className="text-xs text-theme-text-secondary">
                    {t("userOnboarding.photoSet")}
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
                    ? t("userOnboarding.photoUploading")
                    : t("userOnboarding.photoAdd")
                }
                description={t("userOnboarding.photoHint")}
              />
            </div>
            {!isAdmin ? (
              <Button type="submit" disabled={!canFinish} loading={saving}>
                {t("userOnboarding.continue")}
              </Button>
            ) : null}
          </form>
        </Card>

        {isAdmin ? (
          <>
            <GettingStarted
              gated
              workspace={workspace}
              onWorkspaceChange={(next) => {
                setWorkspace(next);
                load();
              }}
              onInvitesChange={load}
            />
            <Button
              type="button"
              disabled={!canFinish}
              loading={saving}
              onClick={handleFinish}
            >
              {t("userOnboarding.finish")}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
