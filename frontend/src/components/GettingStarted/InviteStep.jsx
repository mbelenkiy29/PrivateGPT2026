import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy } from "@phosphor-icons/react";
import { Button, Field } from "@/components/ui/21st";
import Admin from "@/models/admin";
import showToast from "@/utils/toast";

function inviteUrl(code) {
  return `${window.location.origin}/accept-invite/${code}`;
}

export default function InviteStep({ workspace, invites, onInvitesChange }) {
  const { t } = useTranslation();
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [copiedCode, setCopiedCode] = useState(null);
  const workspaceId = workspace?.id;
  const pending = (invites || []).filter(
    (invite) => invite.status === "pending"
  );

  async function handleCreate(e) {
    e.preventDefault();
    if (!workspaceId) {
      showToast(t("gettingStarted.invite.needWorkspace"), "error");
      return;
    }
    setCreating(true);
    const { invite, error } = await Admin.newInvite({
      workspaceIds: [workspaceId],
    });
    if (!invite) {
      showToast(error || t("gettingStarted.invite.createError"), "error");
      setCreating(false);
      return;
    }
    const url = inviteUrl(invite.code);
    try {
      await window.navigator.clipboard.writeText(url);
      setCopiedCode(invite.code);
      showToast(t("gettingStarted.invite.copied"), "success", { clear: true });
    } catch {
      showToast(t("gettingStarted.invite.created"), "success", { clear: true });
    }
    setLabel("");
    onInvitesChange?.();
    setCreating(false);
    window.setTimeout(() => setCopiedCode(null), 2500);
  }

  async function copyLink(code) {
    const url = inviteUrl(code);
    await window.navigator.clipboard.writeText(url);
    setCopiedCode(code);
    showToast(t("gettingStarted.invite.copied"), "success", { clear: true });
    window.setTimeout(() => setCopiedCode(null), 2500);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-theme-text-secondary leading-relaxed">
        {t("gettingStarted.invite.description")}
      </p>
      {!workspaceId ? (
        <p className="text-xs text-theme-text-secondary">
          {t("gettingStarted.invite.needWorkspace")}
        </p>
      ) : (
        <form onSubmit={handleCreate} className="flex flex-col gap-3">
          <Field
            label={t("gettingStarted.invite.label")}
            hint={t("gettingStarted.invite.labelHint")}
            name="invite-label"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t("gettingStarted.invite.placeholder")}
            autoComplete="off"
          />
          <div>
            <Button type="submit" size="sm" loading={creating}>
              {t("gettingStarted.invite.create")}
            </Button>
          </div>
        </form>
      )}
      {pending.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {pending.map((invite) => {
            const url = inviteUrl(invite.code);
            const copied = copiedCode === invite.code;
            return (
              <li
                key={invite.id || invite.code}
                className="flex items-center gap-2 rounded-lg border border-theme-modal-border bg-theme-bg-primary px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-theme-text-secondary">
                  {url}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => copyLink(invite.code)}
                  aria-label={t("gettingStarted.invite.copy")}
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-sky-400" weight="bold" />
                  ) : (
                    <Copy className="h-4 w-4" weight="bold" />
                  )}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
