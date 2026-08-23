import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Sidebar from "@/components/SettingsSidebar";
import { isMobile } from "react-device-detect";
import * as Skeleton from "react-loading-skeleton";
import "react-loading-skeleton/dist/skeleton.css";
import { ArrowSquareOut, EnvelopeSimple } from "@phosphor-icons/react";
import CTAButton from "@/components/lib/CTAButton";
import MailDrafts from "@/models/mailDrafts";
import paths from "@/utils/paths";

function providerLabel(provider) {
  if (provider === "outlook") return "Outlook";
  return "Gmail";
}

function openLabel(provider) {
  return provider === "outlook" ? "Open in Outlook" : "Open in Gmail";
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

export default function MailDraftsPage() {
  const [loading, setLoading] = useState(true);
  const [gmail, setGmail] = useState([]);
  const [outlook, setOutlook] = useState([]);
  const [errors, setErrors] = useState({ gmail: null, outlook: null });

  const fetchDrafts = async () => {
    const result = await MailDrafts.list();
    setGmail(result?.gmail || []);
    setOutlook(result?.outlook || []);
    setErrors(result?.errors || { gmail: null, outlook: null });
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
    errors.gmail === "not connected" && errors.outlook === "not connected";

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
                Pending drafts
              </p>
            </div>
            <p className="text-xs leading-[18px] font-base text-theme-text-secondary mt-2 max-w-[700px]">
              Review Gmail and Outlook drafts created by the agent. Open a
              draft in its mailbox to send — sending is never done from this
              page.
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
              <EnvelopeSimple className="h-4 w-4" weight="bold" /> Refresh
            </CTAButton>
          </div>
          <div className="overflow-x-auto mt-6">
            {loading ? (
              <Skeleton.default
                height="80vh"
                width="100%"
                highlightColor="var(--theme-bg-primary)"
                baseColor="var(--theme-bg-secondary)"
                count={1}
                className="w-full p-4 rounded-b-2xl rounded-tr-2xl rounded-tl-sm"
                containerClassName="flex w-full"
              />
            ) : drafts.length === 0 ? (
              <EmptyState notConnected={bothDisconnected} />
            ) : (
              <table className="w-full text-xs text-left rounded-lg min-w-[720px] border-spacing-0">
                <thead className="text-theme-text-secondary text-xs leading-[18px] font-bold uppercase border-white/10 border-b">
                  <tr>
                    <th scope="col" className="px-6 py-3">
                      Provider
                    </th>
                    <th scope="col" className="px-6 py-3">
                      To
                    </th>
                    <th scope="col" className="px-6 py-3">
                      Subject
                    </th>
                    <th scope="col" className="px-6 py-3">
                      Snippet
                    </th>
                    <th scope="col" className="px-6 py-3">
                      Created
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
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ notConnected = false }) {
  return (
    <div className="flex flex-col items-center justify-center gap-8 py-24 text-center">
      <div className="flex flex-col gap-1.5 max-w-[520px]">
        <p className="text-base font-semibold text-theme-text-primary">
          {notConnected ? "Mail is not connected" : "No pending drafts"}
        </p>
        <p className="text-sm font-medium text-theme-text-secondary">
          {notConnected
            ? "Connect Gmail or Outlook in Agent Skills to list drafts the agent creates for you to send."
            : "When the agent saves a Gmail or Outlook draft, it will show up here so you can review and send it yourself."}
        </p>
      </div>
      <Link
        to={paths.settings.agentSkills()}
        className="border-none h-9 px-5 rounded-lg bg-zinc-50 text-zinc-950 light:bg-slate-900 light:text-white text-sm font-medium hover:bg-zinc-200 light:hover:bg-slate-800 transition-colors flex items-center"
      >
        Open agent skills
      </Link>
    </div>
  );
}

function DraftRow({ draft }) {
  return (
    <tr className="bg-transparent text-white text-opacity-80 text-xs font-medium border-b border-white/10">
      <td className="px-6 py-3 whitespace-nowrap align-middle text-theme-text-primary">
        {providerLabel(draft.provider)}
      </td>
      <td className="px-6 py-3 align-middle text-theme-text-primary max-w-[180px] truncate">
        {draft.to || "—"}
      </td>
      <td className="px-6 py-3 align-middle text-theme-text-primary max-w-[220px] truncate">
        {draft.subject || "(no subject)"}
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
          {openLabel(draft.provider)}
          <ArrowSquareOut className="h-3.5 w-3.5" weight="bold" />
        </a>
      </td>
    </tr>
  );
}
