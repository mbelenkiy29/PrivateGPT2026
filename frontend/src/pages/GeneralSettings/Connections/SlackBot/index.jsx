import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Sidebar from "@/components/SettingsSidebar";
import { isMobile } from "react-device-detect";
import {
  CircleNotch,
  Copy,
  Check,
  Eye,
  EyeSlash,
  SlackLogo,
} from "@phosphor-icons/react";
import Slack from "@/models/slack";
import showToast from "@/utils/toast";
import paths from "@/utils/paths";
import { useTranslation } from "react-i18next";

export default function SlackBotSettings() {
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState(null);

  useEffect(() => {
    async function fetchData() {
      const res = await Slack.botConfig();
      setConfig(res?.config || null);
      setLoading(false);
    }
    fetchData();
  }, []);

  if (loading) {
    return (
      <ConnectionsLayout>
        <div className="flex items-center justify-center h-full">
          <CircleNotch className="h-8 w-8 text-zinc-400 light:text-slate-400 animate-spin" />
        </div>
      </ConnectionsLayout>
    );
  }

  return (
    <ConnectionsLayout fullPage={true}>
      <SlackBotPanel config={config} onChange={setConfig} />
    </ConnectionsLayout>
  );
}

function ConnectionsLayout({ children, fullPage = false }) {
  const { t } = useTranslation();
  return (
    <div className="w-screen h-screen overflow-hidden bg-zinc-950 light:bg-slate-50 flex md:mt-0 mt-6">
      <Sidebar />
      <div
        style={{ height: isMobile ? "100%" : "calc(100% - 32px)" }}
        className="relative md:ml-[2px] md:mr-[16px] md:my-[16px] md:rounded-2xl bg-zinc-900 light:bg-white light:border light:border-slate-300 w-full h-full overflow-y-scroll p-4 md:p-0"
      >
        {fullPage ? (
          <div className="flex flex-col w-full px-1 md:pl-6 md:pr-[50px] md:py-6 py-16">
            <div className="w-full flex flex-col gap-y-2 pb-6 border-b border-white/20 light:border-slate-300">
              <p className="text-lg font-semibold leading-7 text-white light:text-slate-900">
                {t("slack-bot.title")}
              </p>
              <p className="text-xs leading-4 text-zinc-400 light:text-slate-600 max-w-[700px]">
                {t("slack-bot.description")}
              </p>
            </div>
            {children}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function SlackBotPanel({ config, onChange }) {
  const { t } = useTranslation();
  const [signingSecret, setSigningSecret] = useState("");
  const [defaultWorkspace, setDefaultWorkspace] = useState(
    config?.defaultWorkspace || config?.workspaces?.[0]?.slug || ""
  );
  const [saving, setSaving] = useState(false);
  const [disabling, setDisabling] = useState(false);

  const slackConnected = Boolean(config?.slackConnected);
  const enabled = Boolean(config?.active);

  async function handleEnable(e) {
    e.preventDefault();
    if (!config?.configured && !signingSecret.trim())
      return showToast(t("slack-bot.toast-secret-required"), "error");

    setSaving(true);
    const res = await Slack.saveBot({
      signingSecret: signingSecret.trim() || config?.signingSecret,
      defaultWorkspace,
      active: true,
    });
    setSaving(false);
    if (!res.success)
      return showToast(res.error || t("slack-bot.toast-save-failed"), "error");
    onChange(res.config);
    setSigningSecret("");
    showToast(t("slack-bot.toast-saved"), "success");
  }

  async function handleDisable() {
    setDisabling(true);
    const res = await Slack.disableBot();
    setDisabling(false);
    if (!res.success)
      return showToast(
        res.error || t("slack-bot.toast-disable-failed"),
        "error"
      );
    const next = await Slack.botConfig();
    onChange(next?.config || { ...config, active: false });
    showToast(t("slack-bot.toast-disabled"), "success");
  }

  return (
    <div className="flex flex-col gap-y-8 mt-8 max-w-[720px]">
      {!slackConnected && (
        <div className="border border-zinc-700 light:border-slate-200 rounded-xl p-4">
          <p className="text-sm text-zinc-300 light:text-slate-700">
            {t("slack-bot.connect-slack-first")}
          </p>
          <Link
            to={paths.settings.knowledgeSources()}
            className="inline-block mt-3 text-sm font-medium text-white light:text-slate-900 underline"
          >
            {t("slack-bot.open-knowledge-sources")}
          </Link>
        </div>
      )}

      {enabled && (
        <div className="flex items-start gap-x-1 border border-zinc-700 light:border-slate-200 rounded-xl p-3">
          <div className="flex items-center justify-center w-9 h-9 rounded-full bg-[#4A154B] shrink-0">
            <SlackLogo className="h-5 w-5 !text-white" weight="fill" />
          </div>
          <div className="flex flex-col gap-y-1 ml-1">
            <p className="text-sm font-semibold text-white light:text-slate-900">
              {config?.team?.name || t("slack-bot.status")}
            </p>
            <p className="text-xs text-zinc-400 light:text-slate-600">
              {t("slack-bot.status")}
              {config?.defaultWorkspace ? ` · ${config.defaultWorkspace}` : ""}
            </p>
          </div>
        </div>
      )}

      <EventsUrlField value={config?.eventsUrl || ""} />

      <form onSubmit={handleEnable} className="flex flex-col gap-y-[18px]">
        <SigningSecretInput
          value={signingSecret}
          onChange={setSigningSecret}
          placeholder={config?.signingSecret || ""}
        />

        <div className="flex flex-col gap-y-1.5 w-[320px]">
          <label className="text-sm font-medium text-zinc-200 light:text-slate-900">
            {t("slack-bot.default-workspace")}
          </label>
          <select
            value={defaultWorkspace}
            onChange={(e) => setDefaultWorkspace(e.target.value)}
            className="bg-zinc-800 light:bg-white light:border light:border-slate-300 h-8 rounded-lg px-3 text-sm text-white light:text-slate-900 outline-none"
          >
            {(config?.workspaces || []).length === 0 && (
              <option value="">{t("slack-bot.not-connected")}</option>
            )}
            {(config?.workspaces || []).map((ws) => (
              <option key={ws.slug} value={ws.slug}>
                {ws.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-zinc-400 light:text-slate-600">
            {t("slack-bot.default-workspace-hint")}
          </p>
        </div>

        <p className="text-xs text-zinc-400 light:text-slate-600">
          {t("slack-bot.reconnect-scopes")}
        </p>

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={saving || !slackConnected}
            className="flex items-center justify-center gap-x-1.5 text-sm font-medium bg-zinc-50 light:bg-slate-900 text-zinc-900 light:text-white rounded-lg h-9 px-5 w-fit hover:opacity-90 transition-opacity duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? (
              <>
                <CircleNotch className="h-4 w-4 animate-spin" />
                {t("slack-bot.enabling")}
              </>
            ) : (
              <>
                <SlackLogo className="h-5 w-5" weight="fill" />
                {t("slack-bot.enable")}
              </>
            )}
          </button>
          {enabled && (
            <button
              type="button"
              onClick={handleDisable}
              disabled={disabling}
              className="flex items-center justify-center gap-x-1.5 text-sm font-medium border border-zinc-600 light:border-slate-300 text-white light:text-slate-900 rounded-lg h-9 px-5 w-fit hover:opacity-90 transition-opacity duration-200 disabled:opacity-50"
            >
              {disabling ? t("slack-bot.enabling") : t("slack-bot.disable")}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function EventsUrlField({ value }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  return (
    <div className="flex flex-col gap-y-1.5">
      <label className="text-sm font-medium text-zinc-200 light:text-slate-900">
        {t("slack-bot.events-url")}
      </label>
      <div className="flex items-center gap-x-2">
        <code className="bg-zinc-800 light:bg-slate-100 light:border light:border-slate-300 rounded-lg px-3 h-8 flex items-center text-xs text-white light:text-slate-900 flex-1 overflow-hidden">
          {value || "…/api/channels/slack/events"}
        </code>
        <button
          type="button"
          onClick={copy}
          className="flex items-center justify-center h-8 px-3 rounded-lg bg-zinc-800 light:bg-slate-100 text-zinc-200 light:text-slate-800 text-xs"
        >
          {copied ? (
            <Check className="h-4 w-4" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
          <span className="ml-1">
            {copied ? t("slack-bot.copied") : t("slack-bot.copy")}
          </span>
        </button>
      </div>
      <p className="text-xs text-zinc-400 light:text-slate-600 max-w-[700px]">
        {t("slack-bot.events-url-hint")}
      </p>
    </div>
  );
}

function SigningSecretInput({ value, onChange, placeholder }) {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  const Icon = show ? Eye : EyeSlash;

  return (
    <div className="flex flex-col gap-y-1.5 w-[320px]">
      <label className="text-sm font-medium text-zinc-200 light:text-slate-900">
        {t("slack-bot.signing-secret")}
      </label>
      <div className="bg-zinc-800 light:bg-white light:border light:border-slate-300 h-8 rounded-lg px-3.5 flex items-center gap-x-2">
        <button
          type="button"
          onClick={() => setShow(!show)}
          className="text-zinc-400 light:text-slate-500 hover:text-zinc-300 light:hover:text-slate-700 transition-colors shrink-0"
        >
          <Icon className="h-4 w-4" />
        </button>
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || "••••"}
          className="bg-transparent flex-1 text-sm text-white light:text-slate-900 placeholder:text-zinc-400 light:placeholder:text-slate-500 outline-none min-w-0"
          autoComplete="off"
        />
      </div>
      <p className="text-xs text-zinc-400 light:text-slate-600">
        {t("slack-bot.signing-secret-hint")}
      </p>
    </div>
  );
}
