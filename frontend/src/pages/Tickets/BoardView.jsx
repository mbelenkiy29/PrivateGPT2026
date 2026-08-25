import { useState } from "react";
import { useTranslation } from "react-i18next";
import TicketCard from "./TicketCard";
import { TICKET_STATUSES, dropPosition } from "./constants";

export default function BoardView({
  tickets,
  onOpen,
  onStart,
  onMove,
  startingId,
}) {
  const { t } = useTranslation();
  const [overColumn, setOverColumn] = useState(null);

  const grouped = TICKET_STATUSES.reduce((acc, status) => {
    acc[status] = tickets
      .filter((ticket) => ticket.status === status)
      .sort((a, b) => Number(a.position) - Number(b.position));
    return acc;
  }, {});

  const handleDrop = (status, insertIndex, event) => {
    event.preventDefault();
    setOverColumn(null);
    const id = Number(event.dataTransfer.getData("text/ticket-id"));
    if (!id) return;
    const ticket = tickets.find((item) => item.id === id);
    if (!ticket) return;
    const column = grouped[status].filter((item) => item.id !== id);
    const position = dropPosition(column, insertIndex);
    if (ticket.status === status && ticket.position === position) return;
    onMove?.(ticket, { status, position });
  };

  return (
    <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden">
      <div className="flex gap-3 h-full min-w-max pb-2 px-1">
        {TICKET_STATUSES.map((status) => {
          const columnTickets = grouped[status];
          return (
            <section
              key={status}
              className={`w-[260px] shrink-0 flex flex-col rounded-2xl border bg-theme-settings-input-bg/40 ${
                overColumn === status
                  ? "border-sky-500/50"
                  : "border-theme-modal-border"
              }`}
              onDragOver={(event) => {
                event.preventDefault();
                setOverColumn(status);
              }}
              onDragLeave={() => {
                if (overColumn === status) setOverColumn(null);
              }}
              onDrop={(event) =>
                handleDrop(status, columnTickets.length, event)
              }
            >
              <header className="flex items-center justify-between px-3 py-2.5">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-theme-text-secondary">
                  {t(`tickets.status.${status}`)}
                </h2>
                <span className="text-[11px] text-theme-text-secondary">
                  {columnTickets.length}
                </span>
              </header>
              <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 flex flex-col gap-2">
                {columnTickets.map((ticket, index) => (
                  <div
                    key={ticket.id}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onDrop={(event) => {
                      event.stopPropagation();
                      handleDrop(status, index, event);
                    }}
                  >
                    <TicketCard
                      ticket={ticket}
                      onOpen={onOpen}
                      onStart={onStart}
                      starting={startingId === ticket.id}
                    />
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
