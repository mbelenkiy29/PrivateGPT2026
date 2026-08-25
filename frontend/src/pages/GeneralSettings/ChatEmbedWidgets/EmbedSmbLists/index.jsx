import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import truncate from "truncate";
import moment from "moment";
import { useModal } from "@/hooks/useModal";
import Modal, { ModalHeader, ModalBody } from "@/components/lib/Modal";
import Embed from "@/models/embed";
import useQuery from "@/hooks/useQuery";
import LoadingState from "@/components/ui/21st/LoadingState";

const KIND_CONFIG = {
  unanswered: {
    titleKey: "embed-unanswered.title",
    descriptionKey: "embed-unanswered.description",
    emptyKey: "embed-unanswered.empty",
    fetch: (offset) => Embed.unanswered(offset),
    rowsKey: "unanswered",
    columns: [
      { key: "embed", labelKey: "embed-unanswered.table.embed" },
      { key: "question", labelKey: "embed-unanswered.table.question" },
      { key: "session", labelKey: "embed-unanswered.table.session" },
      { key: "at", labelKey: "embed-unanswered.table.at" },
    ],
  },
  leads: {
    titleKey: "embed-leads.title",
    descriptionKey: "embed-leads.description",
    emptyKey: "embed-leads.empty",
    fetch: (offset) => Embed.leads(offset),
    rowsKey: "leads",
    columns: [
      { key: "embed", labelKey: "embed-leads.table.embed" },
      { key: "name", labelKey: "embed-leads.table.name" },
      { key: "email", labelKey: "embed-leads.table.email" },
      { key: "question", labelKey: "embed-leads.table.question" },
      { key: "at", labelKey: "embed-leads.table.at" },
    ],
  },
  handoffs: {
    titleKey: "embed-handoffs.title",
    descriptionKey: "embed-handoffs.description",
    emptyKey: "embed-handoffs.empty",
    fetch: (offset) => Embed.handoffs(offset),
    rowsKey: "handoffs",
    columns: [
      { key: "embed", labelKey: "embed-handoffs.table.embed" },
      { key: "session", labelKey: "embed-handoffs.table.session" },
      { key: "email", labelKey: "embed-handoffs.table.email" },
      { key: "status", labelKey: "embed-handoffs.table.status" },
      { key: "at", labelKey: "embed-handoffs.table.at" },
    ],
  },
};

function workspaceName(row) {
  return row?.embed_config?.workspace?.name || "—";
}

function formatWhen(value) {
  if (!value) return "—";
  const parsed = moment(value);
  if (!parsed.isValid()) return String(value);
  return parsed.diff(moment(), "days") > 0
    ? parsed.format("MMM D, YYYY")
    : parsed.fromNow();
}

export default function EmbedSmbListView({ kind }) {
  const { t } = useTranslation();
  const query = useQuery();
  const config = KIND_CONFIG[kind];
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [offset, setOffset] = useState(Number(query.get("offset") || 0));
  const [canNext, setCanNext] = useState(false);

  useEffect(() => {
    setOffset(0);
  }, [kind]);

  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    async function fetchRows() {
      setLoading(true);
      const result = await config.fetch(offset);
      if (cancelled) return;
      setRows(result?.[config.rowsKey] || []);
      setCanNext(!!result?.hasPages);
      setLoading(false);
    }
    fetchRows();
    return () => {
      cancelled = true;
    };
  }, [kind, offset, config]);

  if (!config) return null;

  if (loading) {
    return <LoadingState size="page" variant="drive" />;
  }

  return (
    <div className="flex flex-col w-full p-4 overflow-none">
      <div className="w-full flex flex-col gap-y-1">
        <p className="text-lg leading-6 font-bold text-theme-text-primary">
          {t(config.titleKey)}
        </p>
        <p className="text-xs leading-[18px] font-base text-theme-text-secondary mt-2">
          {t(config.descriptionKey)}
        </p>
      </div>
      <div className="overflow-x-auto mt-6">
        <table className="w-full text-xs text-left rounded-lg min-w-[640px] border-spacing-0">
          <thead className="text-theme-text-secondary text-xs leading-[18px] font-bold uppercase border-white/10 border-b">
            <tr>
              {config.columns.map((column) => (
                <th key={column.key} scope="col" className="px-6 py-3">
                  {t(column.labelKey)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={config.columns.length}
                  className="px-6 py-8 text-theme-text-secondary"
                >
                  {t(config.emptyKey)}
                </td>
              </tr>
            ) : (
              rows.map((row) => <SmbRow key={row.id} kind={kind} row={row} />)
            )}
          </tbody>
        </table>
        {(offset > 0 || canNext) && (
          <div className="flex items-center justify-end gap-2 mt-4 pb-6">
            <button
              onClick={() => setOffset(Math.max(offset - 1, 0))}
              disabled={offset === 0}
              className={`px-4 py-2 text-sm rounded-lg ${
                offset === 0
                  ? "bg-theme-bg-secondary text-theme-text-disabled cursor-not-allowed"
                  : "bg-theme-bg-secondary text-theme-text-primary hover:bg-theme-hover"
              }`}
            >
              {t("common.previous")}
            </button>
            <button
              onClick={() => setOffset(offset + 1)}
              disabled={!canNext}
              className={`px-4 py-2 text-sm rounded-lg ${
                !canNext
                  ? "bg-theme-bg-secondary text-theme-text-disabled cursor-not-allowed"
                  : "bg-theme-bg-secondary text-theme-text-primary hover:bg-theme-hover"
              }`}
            >
              {t("common.next")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SmbRow({ kind, row }) {
  const { t } = useTranslation();
  if (kind === "leads") {
    return (
      <tr className="bg-transparent text-white text-opacity-80 text-xs font-medium border-b border-white/10 h-10">
        <td className="px-6 whitespace-nowrap">{workspaceName(row)}</td>
        <td className="px-6">{row.name || "—"}</td>
        <td className="px-6">{row.email || "—"}</td>
        <ExpandableCell
          value={row.last_question}
          title={t("embed-leads.table.question")}
        />
        <td className="px-6 whitespace-nowrap">{formatWhen(row.createdAt)}</td>
      </tr>
    );
  }

  if (kind === "handoffs") {
    return (
      <tr className="bg-transparent text-white text-opacity-80 text-xs font-medium border-b border-white/10 h-10">
        <td className="px-6 whitespace-nowrap">{workspaceName(row)}</td>
        <td className="px-6 font-mono">{truncate(row.session_id || "", 20)}</td>
        <td className="px-6">{row.email_to || "—"}</td>
        <td className="px-6">{row.status || "open"}</td>
        <td className="px-6 whitespace-nowrap">
          <div className="flex items-center gap-x-4">
            <span>{formatWhen(row.createdAt)}</span>
            <ExpandableText
              value={row.transcript}
              title={t("embed-handoffs.transcript")}
            />
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="bg-transparent text-white text-opacity-80 text-xs font-medium border-b border-white/10 h-10">
      <td className="px-6 whitespace-nowrap">{workspaceName(row)}</td>
      <ExpandableCell
        value={row.question}
        title={t("embed-unanswered.table.question")}
      />
      <td className="px-6 font-mono">{truncate(row.session_id || "", 20)}</td>
      <td className="px-6 whitespace-nowrap">{formatWhen(row.createdAt)}</td>
    </tr>
  );
}

function ExpandableCell({ value, title }) {
  return (
    <td className={`px-6 ${value ? "cursor-pointer hover:shadow-lg" : ""}`}>
      <ExpandableText value={value} title={title} preview />
    </td>
  );
}

function ExpandableText({ value, title, preview = false }) {
  const { t } = useTranslation();
  const { isOpen, openModal, closeModal } = useModal();
  const text = value || "—";
  return (
    <>
      {preview ? (
        <span onClick={value ? openModal : undefined}>
          {truncate(String(text), 40)}
        </span>
      ) : (
        <button
          type="button"
          onClick={openModal}
          disabled={!value}
          className="text-xs font-medium text-theme-text-secondary hover:text-theme-text-primary disabled:opacity-40"
        >
          {t("embed-handoffs.view")}
        </button>
      )}
      <Modal isOpen={isOpen} onClose={closeModal}>
        <ModalHeader title={title} onClose={closeModal} />
        <ModalBody>
          <p className="whitespace-pre-wrap text-sm text-theme-text-primary">
            {value || "—"}
          </p>
        </ModalBody>
      </Modal>
    </>
  );
}
