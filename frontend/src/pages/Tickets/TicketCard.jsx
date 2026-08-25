import { Play, User } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import Button from "@/components/ui/21st/Button";
import LoadingState from "@/components/ui/21st/LoadingState";
import { isActiveRun } from "./constants";

function runTone(status) {
  if (status === "failed" || status === "timed_out" || status === "killed")
    return "text-red-400";
  if (status === "completed") return "text-emerald-400";
  if (status === "queued" || status === "running")
    return "italic text-theme-text-secondary";
  return "text-theme-text-secondary";
}

export default function TicketCard({
  ticket,
  onOpen,
  onStart,
  starting = false,
  draggable = true,
}) {
  const { t } = useTranslation();
  const tools = Array.isArray(ticket.tools) ? ticket.tools : [];
  const running = isActiveRun(ticket);

  return (
    <article
      draggable={draggable}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/ticket-id", String(ticket.id));
        event.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => onOpen?.(ticket)}
      className="group cursor-pointer rounded-xl border border-theme-modal-border bg-theme-bg-primary p-3 flex flex-col gap-2 text-left hover:border-sky-500/40 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-theme-text-primary leading-snug line-clamp-2">
          {ticket.title}
        </h3>
        {ticket.priority && ticket.priority !== "none" && (
          <span className="text-[10px] uppercase tracking-wide font-semibold text-theme-text-secondary shrink-0">
            {t(`tickets.priority.${ticket.priority}`)}
          </span>
        )}
      </div>
      {tools.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tools.slice(0, 3).map((id) => (
            <span
              key={id}
              className="text-[10px] px-1.5 py-0.5 rounded-full bg-theme-sidebar-item-default text-theme-text-secondary"
            >
              {id}
            </span>
          ))}
          {tools.length > 3 && (
            <span className="text-[10px] text-theme-text-secondary">
              +{tools.length - 3}
            </span>
          )}
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-[11px] text-theme-text-secondary min-w-0">
          <User size={12} />
          <span className="truncate">
            {ticket.assignee?.username || t("tickets.unassigned")}
          </span>
        </span>
        {ticket.latestRun?.status && (
          <span className={`text-[11px] ${runTone(ticket.latestRun.status)}`}>
            {t(
              `tickets.runStatus.${ticket.latestRun.status}`,
              ticket.latestRun.status
            )}
          </span>
        )}
      </div>
      <Button
        size="sm"
        variant={running ? "secondary" : "outline"}
        className="self-start"
        disabled={running || starting}
        loading={starting}
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
    </article>
  );
}
