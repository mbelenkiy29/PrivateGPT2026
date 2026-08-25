import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CaretDown, CaretUp, Play } from "@phosphor-icons/react";
import Button from "@/components/ui/21st/Button";
import LoadingState from "@/components/ui/21st/LoadingState";
import { TICKET_STATUSES, isActiveRun } from "./constants";

const COLUMNS = [
  "title",
  "status",
  "assignee",
  "tools",
  "workspace",
  "priority",
  "due",
  "updated",
  "actions",
];

function formatDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return "—";
  }
}

export default function TableView({
  tickets,
  onOpen,
  onStart,
  onMove,
  startingId,
}) {
  const { t } = useTranslation();
  const [sortKey, setSortKey] = useState("updated");
  const [sortDir, setSortDir] = useState("desc");

  const sorted = useMemo(() => {
    const copy = [...tickets];
    copy.sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      const av = sortValue(a, sortKey);
      const bv = sortValue(b, sortKey);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
    return copy;
  }, [tickets, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (key === "actions") return;
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "title" ? "asc" : "desc");
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-auto rounded-2xl border border-theme-modal-border">
      <table className="w-full text-sm text-left">
        <thead className="sticky top-0 bg-theme-bg-secondary text-[11px] uppercase tracking-wide text-theme-text-secondary">
          <tr>
            {COLUMNS.map((key) => (
              <th
                key={key}
                className="px-3 py-2 font-semibold whitespace-nowrap"
              >
                {key === "actions" ? (
                  t("tickets.table.actions")
                ) : (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 bg-transparent border-none text-theme-text-secondary hover:text-theme-text-primary"
                    onClick={() => toggleSort(key)}
                  >
                    {t(`tickets.table.${key}`)}
                    {sortKey === key &&
                      (sortDir === "asc" ? (
                        <CaretUp size={12} />
                      ) : (
                        <CaretDown size={12} />
                      ))}
                  </button>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((ticket) => {
            const running = isActiveRun(ticket);
            return (
              <tr
                key={ticket.id}
                onClick={() => onOpen?.(ticket)}
                className="border-t border-theme-modal-border hover:bg-theme-file-picker-hover cursor-pointer"
              >
                <td className="px-3 py-2.5 text-theme-text-primary font-medium max-w-[240px] truncate">
                  {ticket.title}
                </td>
                <td className="px-3 py-2.5">
                  <select
                    value={ticket.status}
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) =>
                      onMove?.(ticket, { status: event.target.value })
                    }
                    className="h-8 rounded-lg border border-theme-modal-border bg-theme-settings-input-bg text-theme-text-primary text-xs px-2"
                  >
                    {TICKET_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {t(`tickets.status.${status}`)}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2.5 text-theme-text-secondary">
                  {ticket.assignee?.username || t("tickets.unassigned")}
                </td>
                <td className="px-3 py-2.5 text-theme-text-secondary max-w-[180px] truncate">
                  {(ticket.tools || []).join(", ") || "—"}
                </td>
                <td className="px-3 py-2.5 text-theme-text-secondary">
                  {ticket.workspace?.name || "—"}
                </td>
                <td className="px-3 py-2.5 text-theme-text-secondary">
                  {t(`tickets.priority.${ticket.priority || "none"}`)}
                </td>
                <td className="px-3 py-2.5 text-theme-text-secondary">
                  {formatDate(ticket.dueDate)}
                </td>
                <td className="px-3 py-2.5 text-theme-text-secondary">
                  {formatDate(ticket.lastUpdatedAt)}
                </td>
                <td className="px-3 py-2.5">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={running || startingId === ticket.id}
                    loading={startingId === ticket.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      onStart?.(ticket);
                    }}
                  >
                    {running ? (
                      <LoadingState
                        size="grid"
                        variant="orbit"
                        label={t("tickets.running")}
                      />
                    ) : (
                      <Play size={12} weight="fill" />
                    )}
                    {running ? t("tickets.running") : t("tickets.start")}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function sortValue(ticket, key) {
  switch (key) {
    case "title":
      return (ticket.title || "").toLowerCase();
    case "status":
      return ticket.status || "";
    case "assignee":
      return (ticket.assignee?.username || "").toLowerCase();
    case "tools":
      return (ticket.tools || []).join(",");
    case "workspace":
      return (ticket.workspace?.name || "").toLowerCase();
    case "priority":
      return ticket.priority || "";
    case "due":
      return ticket.dueDate || "";
    case "updated":
    default:
      return ticket.lastUpdatedAt || "";
  }
}
