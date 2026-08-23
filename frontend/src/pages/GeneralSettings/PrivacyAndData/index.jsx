import { useEffect, useState } from "react";
import Sidebar from "@/components/SettingsSidebar";
import { isMobile } from "react-device-detect";
import showToast from "@/utils/toast";
import System from "@/models/system";
import Admin from "@/models/admin";
import Trust from "@/models/trust";
import PreLoader from "@/components/Preloader";
import { useTranslation } from "react-i18next";
import ProviderPrivacy from "@/components/ProviderPrivacy";
import { PROVIDER_PRIVACY_MAP } from "@/components/ProviderPrivacy/constants";
import Toggle from "@/components/lib/Toggle";
import { numberWithCommas } from "@/utils/numbers";

// Matches server FREE_PROVIDERS — unknown/proxy LLMs are treated as cloud.
const LOCAL_LLM_PROVIDERS = [
  "ollama",
  "lmstudio",
  "localai",
  "koboldcpp",
  "textgenwebui",
  "omlx",
  "lemonade",
  "docker-model-runner",
  "foundry",
  "nvidia-nim",
];

function isLocalLlm(provider) {
  return LOCAL_LLM_PROVIDERS.includes(provider);
}

function formatUsd(value) {
  const n = Number(value) || 0;
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function destinationLabel(summary, t) {
  const local = Number(summary?.local) || 0;
  const cloud = Number(summary?.cloud) || 0;
  if (local === 0 && cloud === 0) return t("privacy.destination.none");
  if (local > 0 && cloud === 0) return t("privacy.destination.this_server");
  if (cloud > 0 && local === 0) return t("privacy.destination.named_cloud");
  return t("privacy.destination.mixed");
}

export default function PrivacyAndDataHandling() {
  const [settings, setSettings] = useState({});
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();

  useEffect(() => {
    async function fetchPage() {
      setLoading(true);
      const [nextSettings, nextSummary] = await Promise.all([
        System.keys(),
        Trust.summary(),
      ]);
      setSettings(nextSettings || {});
      setSummary(nextSummary);
      setLoading(false);
    }
    fetchPage();
  }, []);

  const llmIsCloud = !isLocalLlm(settings?.LLMProvider);

  return (
    <div className="w-screen h-screen overflow-hidden bg-theme-bg-container flex">
      <Sidebar />
      <div
        style={{ height: isMobile ? "100%" : "calc(100% - 32px)" }}
        className="relative md:ml-[2px] md:mr-[16px] md:my-[16px] md:rounded-[16px] light:border light:border-theme-sidebar-border bg-theme-bg-secondary w-full h-full overflow-y-scroll p-4 md:p-0"
      >
        <div className="flex flex-col w-full px-1 md:pl-6 md:pr-[50px] md:py-6 py-16">
          <div className="w-full flex flex-col gap-y-1 pb-6 border-white/10 border-b-2">
            <div className="items-center flex gap-x-4">
              <p className="text-lg leading-6 font-bold text-theme-text-primary">
                {t("privacy.title")}
              </p>
            </div>
            <p className="text-xs leading-[18px] font-base text-theme-text-secondary">
              {t("privacy.description")}
            </p>
          </div>
          {loading ? (
            <div className="h-1/2 transition-all duration-500 relative md:ml-[2px] md:mr-[8px] md:my-[16px] md:rounded-[26px] p-[18px] h-full overflow-y-scroll">
              <div className="w-full h-full flex justify-center items-center">
                <PreLoader />
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto flex flex-col gap-y-8 pt-6 max-w-4xl">
              <TrustSummary summary={summary} settings={settings} />
              <NoTrainingCopy llmIsCloud={llmIsCloud} />
              <ProviderPrivacy />
              <RetentionSlider
                initialDays={summary?.retention_days}
                onSaved={(days) =>
                  setSummary((prev) =>
                    prev ? { ...prev, retention_days: days } : prev
                  )
                }
              />
              <UserDataControls />
              <TelemetryLogs settings={settings} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TrustSummary({ summary, settings }) {
  const { t } = useTranslation();
  const llmName =
    PROVIDER_PRIVACY_MAP.llm[settings?.LLMProvider]?.name ||
    settings?.LLMProvider ||
    t("privacy.destination.unknown");
  const currentDestination = isLocalLlm(settings?.LLMProvider)
    ? t("privacy.destination.this_server")
    : t("privacy.destination.named_cloud");
  const since = summary?.period?.since
    ? new Date(summary.period.since).toLocaleDateString()
    : null;

  return (
    <div className="flex flex-col gap-y-3">
      <div className="flex flex-col gap-y-1">
        <p className="text-theme-text-primary text-base font-bold">
          {t("privacy.summary.title")}
        </p>
        <p className="text-theme-text-secondary text-xs">
          {since
            ? t("privacy.spend.period", { date: since })
            : t("privacy.summary.description")}
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <SummaryCard
          label={t("privacy.destination.title")}
          value={destinationLabel(summary, t)}
          hint={t("privacy.destination.current", {
            provider: llmName,
            destination: currentDestination,
          })}
        />
        <SummaryCard
          label={t("privacy.citations.title")}
          value={t("privacy.citations.headline")}
          hint={t("privacy.citations.description")}
        />
        <SummaryCard
          label={t("privacy.spend.title")}
          value={formatUsd(summary?.cost_usd)}
          hint={`${t("privacy.spend.cost")} · ${numberWithCommas((Number(summary?.prompt_tokens) || 0) + (Number(summary?.completion_tokens) || 0))} ${t("privacy.spend.tokens")}`}
        />
        <SummaryCard
          label={t("privacy.spend.requests")}
          value={numberWithCommas(Number(summary?.count) || 0)}
          hint={`${t("privacy.spend.local")}: ${numberWithCommas(Number(summary?.local) || 0)} · ${t("privacy.spend.cloud")}: ${numberWithCommas(Number(summary?.cloud) || 0)}`}
        />
      </div>
    </div>
  );
}

function SummaryCard({ label, value, hint }) {
  return (
    <div className="flex flex-col gap-y-1 p-4 rounded-lg bg-theme-bg-primary border border-white/10">
      <p className="text-theme-text-secondary text-xs font-medium uppercase tracking-wide">
        {label}
      </p>
      <p className="text-theme-text-primary text-lg font-bold leading-6">
        {value}
      </p>
      {hint && (
        <p className="text-theme-text-secondary text-xs leading-[16px]">
          {hint}
        </p>
      )}
    </div>
  );
}

function NoTrainingCopy({ llmIsCloud }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-y-2 p-4 rounded-lg border border-white/10 bg-theme-bg-primary">
      <p className="text-theme-text-primary text-sm font-semibold">
        {t("privacy.no_training")}
      </p>
      <p className="text-theme-text-secondary text-xs leading-[18px]">
        {llmIsCloud
          ? t("privacy.no_training_cloud")
          : t("privacy.no_training_local")}
      </p>
    </div>
  );
}

function RetentionSlider({ initialDays = 90, onSaved }) {
  const { t } = useTranslation();
  const [days, setDays] = useState(
    Number.isFinite(Number(initialDays)) ? Number(initialDays) : 90
  );
  const [saving, setSaving] = useState(false);
  const savedDays = Number.isFinite(Number(initialDays))
    ? Number(initialDays)
    : 90;
  const dirty = days !== savedDays;

  const handleSave = async () => {
    setSaving(true);
    const result = await Trust.setRetention(days);
    setSaving(false);
    if (!result?.success) {
      showToast(result?.error || t("privacy.retention.failed"), "error", {
        clear: true,
      });
      return;
    }
    onSaved?.(result.days);
    showToast(t("privacy.retention.saved"), "success", { clear: true });
  };

  return (
    <div className="flex flex-col gap-y-3 pb-4 border-b border-white/10">
      <div className="flex flex-col gap-y-1">
        <p className="text-theme-text-primary text-base font-bold">
          {t("privacy.retention.title")}
        </p>
        <p className="text-theme-text-secondary text-xs">
          {t("privacy.retention.description")}
        </p>
      </div>
      <div className="flex items-center justify-between gap-x-4">
        <p className="text-theme-text-primary text-sm font-semibold">
          {days === 0
            ? t("privacy.retention.forever")
            : t("privacy.retention.days", { count: days })}
        </p>
        <input
          type="number"
          min={0}
          max={365}
          step={1}
          value={days}
          onWheel={(e) => e.target.blur()}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (!Number.isFinite(next)) return;
            setDays(Math.min(365, Math.max(0, Math.floor(next))));
          }}
          className="border-none bg-theme-settings-input-bg text-white placeholder:text-theme-settings-input-placeholder text-sm rounded-lg focus:outline-primary-button outline-none w-24 p-2.5"
        />
      </div>
      <input
        type="range"
        min={0}
        max={365}
        step={1}
        value={days}
        onChange={(e) => setDays(Number(e.target.value))}
        className="w-full accent-sky-400"
        aria-label={t("privacy.retention.title")}
      />
      <div className="flex justify-between text-[11px] text-theme-text-secondary">
        <span>{t("privacy.retention.forever")}</span>
        <span>{t("privacy.retention.days", { count: 90 })}</span>
        <span>{t("privacy.retention.days", { count: 365 })}</span>
      </div>
      <button
        type="button"
        disabled={saving || !dirty}
        onClick={handleSave}
        className="border-none text-xs px-4 py-1 font-semibold rounded-lg bg-primary-button text-white h-[34px] w-fit disabled:opacity-50"
      >
        {t("privacy.retention.save")}
      </button>
    </div>
  );
}

function UserDataControls() {
  const { t } = useTranslation();
  const [users, setUsers] = useState([]);
  const [userId, setUserId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    async function fetchUsers() {
      const nextUsers = await Admin.users();
      setUsers(Array.isArray(nextUsers) ? nextUsers : []);
    }
    fetchUsers();
  }, []);

  const selected = users.find((user) => String(user.id) === String(userId));

  const handleExport = async () => {
    if (!userId) return;
    setBusy(true);
    const data = await Trust.exportUserData(userId);
    setBusy(false);
    if (data?.error || !data?.exportedAt) {
      showToast(data?.error || t("privacy.gdpr.export_failed"), "error", {
        clear: true,
      });
      return;
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `user-${userId}-data-export.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast(t("privacy.gdpr.export_success"), "success", { clear: true });
  };

  const handleDelete = async () => {
    if (!userId) return;
    if (
      !window.confirm(
        t("privacy.gdpr.delete_confirm", {
          username: selected?.username || userId,
        })
      )
    )
      return;
    setBusy(true);
    const result = await Trust.deleteUserData(userId);
    setBusy(false);
    if (!result?.success) {
      showToast(result?.error || t("privacy.gdpr.delete_failed"), "error", {
        clear: true,
      });
      return;
    }
    showToast(t("privacy.gdpr.delete_success"), "success", { clear: true });
  };

  return (
    <div className="flex flex-col gap-y-3 pb-4 border-b border-white/10">
      <div className="flex flex-col gap-y-1">
        <p className="text-theme-text-primary text-base font-bold">
          {t("privacy.gdpr.title")}
        </p>
        <p className="text-theme-text-secondary text-xs">
          {t("privacy.gdpr.description")}
        </p>
      </div>
      {users.length === 0 ? (
        <p className="text-theme-text-secondary text-xs">
          {t("privacy.gdpr.no_users")}
        </p>
      ) : (
        <>
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="border-none bg-theme-settings-input-bg text-white text-sm rounded-lg focus:outline-primary-button outline-none w-full max-w-sm p-2.5"
          >
            <option value="">{t("privacy.gdpr.select_user")}</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.username}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-x-3">
            <button
              type="button"
              disabled={busy || !userId}
              onClick={handleExport}
              className="border-none text-xs px-4 py-1 font-semibold rounded-lg bg-primary-button text-white h-[34px] w-fit disabled:opacity-50"
            >
              {t("privacy.gdpr.export")}
            </button>
            <button
              type="button"
              disabled={busy || !userId}
              onClick={handleDelete}
              className="border-none text-xs px-4 py-1 font-semibold rounded-lg bg-red-600/80 hover:bg-red-600 text-white h-[34px] w-fit disabled:opacity-50"
            >
              {t("privacy.gdpr.delete")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function TelemetryLogs({ settings }) {
  const [telemetry, setTelemetry] = useState(
    settings?.DisableTelemetry !== "true"
  );
  const { t } = useTranslation();
  async function toggleTelemetry() {
    await System.updateSystem({
      DisableTelemetry: !telemetry ? "false" : "true",
    });
    setTelemetry(!telemetry);
    showToast(
      `Anonymous Telemetry has been ${!telemetry ? "enabled" : "disabled"}.`,
      "info",
      { clear: true }
    );
  }

  return (
    <div className="relative w-full max-h-full">
      <div className="relative rounded-lg">
        <div className="space-y-6 flex h-full w-full">
          <div className="w-full flex flex-col gap-y-4">
            <div className="">
              <Toggle
                size="lg"
                className="mb-4"
                label={t("privacy.anonymous")}
                enabled={telemetry}
                onChange={toggleTelemetry}
              />
            </div>
          </div>
        </div>
        <div className="flex flex-col items-left space-y-2">
          <p className="text-theme-text-secondary text-xs rounded-lg w-96">
            All events do not record IP-address and contain{" "}
            <b>no identifying</b> content, settings, chats, or other non-usage
            based information. To see the list of event tags collected you can
            look on{" "}
            <a
              href="https://github.com/search?q=repo%3AMintplex-Labs%2Fanything-llm%20.sendTelemetry(&type=code"
              className="underline text-blue-400"
              target="_blank"
              rel="noreferrer"
            >
              GitHub here
            </a>
            .
          </p>
          <p className="text-theme-text-secondary text-xs rounded-lg w-96">
            As an open-source project we respect your right to privacy. We are
            dedicated to building the best solution for integrating AI and
            documents privately and securely. If you do decide to turn off
            telemetry all we ask is to consider sending us feedback and thoughts
            so that we can continue to improve PrivateGPT for you.{" "}
            <a
              href="mailto:team@mintplexlabs.com"
              className="underline text-blue-400"
              target="_blank"
              rel="noreferrer"
            >
              team@mintplexlabs.com
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
