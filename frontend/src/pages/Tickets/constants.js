export const TICKET_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "done",
  "cancelled",
];

export const TICKET_PRIORITIES = ["none", "low", "medium", "high", "urgent"];

export const ACTIVE_RUN_STATUSES = ["queued", "running"];

export function isActiveRun(ticket) {
  return ACTIVE_RUN_STATUSES.includes(ticket?.latestRun?.status);
}

export function dropPosition(columnTickets, insertIndex) {
  const before = insertIndex > 0 ? columnTickets[insertIndex - 1] : null;
  const after =
    insertIndex < columnTickets.length ? columnTickets[insertIndex] : null;
  if (!before && !after) return 1;
  if (!before) return Number(after.position) - 1;
  if (!after) return Number(before.position) + 1;
  return (Number(before.position) + Number(after.position)) / 2;
}
