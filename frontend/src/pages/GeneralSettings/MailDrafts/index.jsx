import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Sidebar from "@/components/SettingsSidebar";
import { isMobile } from "react-device-detect";
import { ArrowSquareOut, EnvelopeSimple, Warning } from "@phosphor-icons/react";
import CTAButton from "@/components/lib/CTAButton";
import MailDrafts from "@/models/mailDrafts";
import paths from "@/utils/paths";
import LoadingState from "@/components/ui/21st/LoadingState";

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function isProviderError(error) {
  return !!error && error !== "not connected";
}

export default function MailDraftsPage() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [gmail, setGmail] = useState([]);
  const [outlook, setOutlook] = useState([]);
  const [errors, setErrors] = useState({ gmail: null, outlook: null });
  const [fetchError, setFetchError] = useState(null);

  const fetchDrafts = async () => {
    const result = await MailDrafts.list();
    setGmail(result?.gmail || []);
    setOutlook(result?.outlook || []);
    setErrors(result?.errors || { gmail: null, outlook: null });
    setFetchError(result?.fetchError || null);
    setLoading(false);
  };

  useEffect(() => {
    fetchDrafts();
  }, []);

  const drafts = useMemo(() => {
    return [...gmail, ...outlook].sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });
  }, [gmail, outlook]);

  const bothDisconnected =
    !fetchError &&
    errors.gmail === "not connected" &&
    errors.outlook === "not connected";

  const errorMessages = useMemo(() => {
    const messages = [];
    if (fetchError) {
      messages.push(t("mailDrafts.errors.fetch", { message: fetchError }));
    }
    if (isProviderError(errors.gmail)) {
      messages.push(
        t("mailDrafts.errors.provider", {
          provider: t("mailDrafts.providers.gmail"),
          message: errors.gmail,
        })
      );
    }
    if (isProviderError(errors.outlook)) {
      messages.push(
        t("mailDrafts.errors.provider", {
          provider: t("mailDrafts.providers.outlook"),
          message: errors.outlook,
        })
      );
    }
    return messages;
  }, [fetchError, errors, t]);

  const emptyKind = fetchError
    ? "loadFailed"
    : bothDisconnected
      ? "notConnected"
      : errorMessages.length > 0
        ? "loadFailed"
        : "none";

  return (
    <div className="w-screen h-screen overflow-hidden bg-theme-bg-container flex">
      <Sidebar />
      <div
        style={{ height: isMobile ? "100%" : "calc(100% - 32px)" }}
        className="relative md:ml-[2px] md:mr-[16px] md:my-[16px] md:rounded-[16px] bg-theme-bg-secondary w-full h-full overflow-y-scroll p-4 md:p-0"
      >
        <div className="flex flex-col w-full px-1 md:pl-6 md:pr-[50px] md:py-6 py-16">
          <div className="w-full flex flex-col gap-y-1 pb-6 border-white/10 light:border-slate-300 border-b-2">
            <div className="items-center flex gap-x-4">
              <p className="text-lg leading-6 font-bold text-theme-text-primary">
                {t("mailDrafts.title")}
              </p>
            </div>
            <p className="text-xs leading-[18px] font-base text-theme-text-secondary mt-2 max-w-[700px]">
              {t("mailDrafts.description")}
            </p>
          </div>
          <div className="w-full justify-end flex">
            <CTAButton
              onClick={() => {
                setLoading(true);
                fetchDrafts();
              }}
              className="mt-3 mr-0 mb-4 md:-mb-14 z-10"
            >
              <EnvelopeSimple className="h-4 w-4" weight="bold" />{" "}
              {t("mailDrafts.refresh")}
            </CTAButton>
          </div>
          <div className="overflow-x-auto mt-6">
            {loading ? (
              <LoadingState size="page" variant="drive" />
            ) : (
              <>
                <ErrorBanners messages={errorMessages} />
                {drafts.length === 0 ? (
                  <EmptyState kind={emptyKind} />
                ) : (
                  <table className="w-full text-xs text-left rounded-lg min-w-[720px] border-spacing-0">
                    <thead className="text-theme-text-secondary text-xs leading-[18px] font-bold uppercase border-white/10 border-b">
                      <tr>
                        <th scope="col" className="px-6 py-3">
                          {t("mailDrafts.table.provider")}
                        </th>
                        <th scope="col" className="px-6 py-3">
                          {t("mailDrafts.table.to")}
                        </th>
                        <th scope="col" className="px-6 py-3">
                          {t("mailDrafts.table.subject")}
                        </th>
                        <th scope="col" className="px-6 py-3">
                          {t("mailDrafts.table.snippet")}
                        </th>
                        <th scope="col" className="px-6 py-3">
                          {t("mailDrafts.table.created")}
                        </th>
                        <th scope="col" className="px-6 py-3">
                          {" "}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {drafts.map((draft) => (
                        <DraftRow
                          key={`${draft.provider}-${draft.id}`}
                          draft={draft}
                        />
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ErrorBanners({ messages = [] }) {
  if (!messages.length) return null;
  return (
    <div className="flex flex-col gap-2 mb-4">
      {messages.map((message) => (
        <div
          key={message}
          className="flex items-center gap-x-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg"
        >
          <Warning size={20} className="text-yellow-500 shrink-0" />
          <p className="text-yellow-500 text-xs">{message}</p>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ kind = "none" }) {
  const { t } = useTranslation();
  const titleKey =
    kind === "notConnected"
      ? "mailDrafts.empty.notConnectedTitle"
      : kind === "loadFailed"
        ? "mailDrafts.empty.loadFailedTitle"
        : "mailDrafts.empty.noneTitle";
  const subtitleKey =
    kind === "notConnected"
      ? "mailDrafts.empty.notConnectedSubtitle"
      : kind === "loadFailed"
        ? "mailDrafts.empty.loadFailedSubtitle"
        : "mailDrafts.empty.noneSubtitle";

  return (
    <div className="flex flex-col items-center justify-center gap-8 py-24 text-center">
      <div className="flex flex-col gap-1.5 max-w-[520px]">
        <p className="text-base font-semibold text-theme-text-primary">
          {t(titleKey)}
        </p>
        <p className="text-sm font-medium text-theme-text-secondary">
          {t(subtitleKey)}
        </p>
      </div>
      {kind !== "loadFailed" && (
        <Link
          to={paths.settings.agentSkills()}
          className="border-none h-9 px-5 rounded-lg bg-zinc-50 text-zinc-950 light:bg-slate-900 light:text-white text-sm font-medium hover:bg-zinc-200 light:hover:bg-slate-800 transition-colors flex items-center"
        >
          {t("mailDrafts.empty.openSkills")}
        </Link>
      )}
    </div>
  );
}

function DraftRow({ draft }) {
  const { t } = useTranslation();
  const provider = t(
    `mailDrafts.providers.${draft.provider}`,
    draft.provider === "outlook" ? "Outlook" : "Gmail"
  );

  return (
    <tr className="bg-transparent text-white text-opacity-80 text-xs font-medium border-b border-white/10">
      <td className="px-6 py-3 whitespace-nowrap align-middle text-theme-text-primary">
        {provider}
      </td>
      <td className="px-6 py-3 align-middle text-theme-text-primary max-w-[180px] truncate">
        {draft.to || "—"}
      </td>
      <td className="px-6 py-3 align-middle text-theme-text-primary max-w-[220px] truncate">
        {draft.subject || t("mailDrafts.noSubject")}
      </td>
      <td className="px-6 py-3 align-middle text-theme-text-secondary max-w-[280px] truncate">
        {draft.snippet || "—"}
      </td>
      <td className="px-6 py-3 whitespace-nowrap align-middle text-theme-text-secondary">
        {formatDate(draft.createdAt)}
      </td>
      <td className="px-6 py-3 align-middle">
        <a
          href={draft.openUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-x-1 text-xs font-medium text-blue-300 light:text-blue-500 hover:underline"
        >
          {t("mailDrafts.openIn", { provider })}
          <ArrowSquareOut className="h-3.5 w-3.5" weight="bold" />
        </a>
      </td>
    </tr>
  );
}
