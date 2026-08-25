import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { X, Play, Stop, Trash, ChatText } from "@phosphor-icons/react";
import Button from "@/components/ui/21st/Button";
import Field from "@/components/ui/21st/Field";
import ToolsSelector from "@/pages/GeneralSettings/ScheduledJobs/JobFormModal/ToolsSelector";
import Tickets from "@/models/tickets";
import showToast from "@/utils/toast";
import paths from "@/utils/paths";
import { TICKET_PRIORITIES, TICKET_STATUSES, isActiveRun } from "./constants";

const inputClass =
  "flex h-9 w-full rounded-lg border border-theme-modal-border bg-theme-settings-input-bg px-3 py-2 text-sm text-theme-text-primary shadow-sm placeholder:text-theme-settings-input-placeholder focus-visible:border-sky-500/50 focus-visible:outline-none disabled:opacity-50";

function dueInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export default function TicketDrawer({
  ticket,
  workspaces,
  availableTools,
  onClose,
  onSaved,
  onDeleted,
  onStart,
  onKill,
  starting = false,
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isNew = !ticket?.id;
  const [form, setForm] = useState(formFromTicket(ticket, workspaces));
  const [saving, setSaving] = useState(false);
  const [runs, setRuns] = useState([]);
  const [assignees, setAssignees] = useState([]);
  const [multiUser, setMultiUser] = useState(false);

  useEffect(() => {
    setForm(formFromTicket(ticket, workspaces));
    // Only re-seed when opening a different ticket so polling run status
    // does not wipe fields the user is editing.
  }, [ticket?.id, workspaces]);

  useEffect(() => {
    if (!form.workspaceId) {
      setAssignees([]);
      setMultiUser(false);
      return;
    }
    Tickets.assignees(form.workspaceId).then((res) => {
      setAssignees(res.assignees || []);
      setMultiUser(!!res.multiUser);
    });
  }, [form.workspaceId]);

  useEffect(() => {
    if (!ticket?.id) {
      setRuns([]);
      return;
    }
    Tickets.runs(ticket.id).then((res) => setRuns(res.runs || []));
  }, [ticket?.id, ticket?.latestRun?.status, ticket?.latestRun?.id]);

  const setField = (key, value) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const save = async () => {
    if (!form.title.trim()) {
      showToast(t("tickets.errors.titleRequired"), "error");
      return;
    }
    if (!form.workspaceId) {
      showToast(t("tickets.errors.workspaceRequired"), "error");
      return;
    }
    setSaving(true);
    const payload = {
      title: form.title.trim(),
      description: form.description,
      workspaceId: Number(form.workspaceId),
      status: form.status,
      priority: form.priority,
      dueDate: form.dueDate || null,
      tools: form.tools,
      assigneeUserId: form.assigneeUserId || null,
    };
    const result = isNew
      ? await Tickets.create(payload)
      : await Tickets.update(ticket.id, payload);
    setSaving(false);
    if (result.error || !result.ticket) {
      showToast(result.error || t("tickets.errors.saveFailed"), "error");
      return;
    }
    showToast(
      isNew ? t("tickets.toast.created") : t("tickets.toast.updated"),
      "success",
      { clear: true }
    );
    onSaved?.(result.ticket);
  };

  const remove = async () => {
    if (!ticket?.id) return;
    if (!window.confirm(t("tickets.confirmDelete"))) return;
    const { success } = await Tickets.delete(ticket.id);
    if (!success) {
      showToast(t("tickets.errors.deleteFailed"), "error");
      return;
    }
    showToast(t("tickets.toast.deleted"), "success", { clear: true });
    onDeleted?.(ticket);
  };

  const openChat = async (run) => {
    const result = await Tickets.continueInThread(run.id);
    if (result.error || !result.workspaceSlug || !result.threadSlug) {
      showToast(result.error || t("tickets.errors.openChat"), "error");
      return;
    }
    navigate(paths.workspace.thread(result.workspaceSlug, result.threadSlug));
  };

  const running = !isNew && isActiveRun(ticket);

  return (
    <div className="fixed inset-0 z-[80]">
      <button
        type="button"
        className="absolute inset-0 bg-black/50 border-none"
        aria-label={t("tickets.close")}
        onClick={onClose}
      />
      <aside className="absolute right-0 top-0 h-full w-full max-w-[440px] bg-theme-bg-secondary border-l border-theme-modal-border flex flex-col">
        <header className="flex items-center justify-between px-5 py-4 border-b border-theme-modal-border">
          <h2 className="text-sm font-semibold text-theme-text-primary">
            {isNew ? t("tickets.new") : t("tickets.edit")}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label={t("tickets.close")}
          >
            <X size={16} />
          </Button>
        </header>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-3">
          <Field
            label={t("tickets.fields.title")}
            value={form.title}
            onChange={(e) => setField("title", e.target.value)}
            placeholder={t("tickets.placeholders.title")}
          />
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-theme-text-secondary">
              {t("tickets.fields.description")}
            </span>
            <textarea
              rows={5}
              value={form.description}
              onChange={(e) => setField("description", e.target.value)}
              placeholder={t("tickets.placeholders.description")}
              className={`${inputClass} h-auto min-h-[120px]`}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-theme-text-secondary">
              {t("tickets.fields.workspace")}
            </span>
            <select
              className={inputClass}
              value={form.workspaceId}
              onChange={(e) => setField("workspaceId", e.target.value)}
            >
              <option value="">{t("tickets.placeholders.workspace")}</option>
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-theme-text-secondary">
                {t("tickets.fields.status")}
              </span>
              <select
                className={inputClass}
                value={form.status}
                onChange={(e) => setField("status", e.target.value)}
              >
                {TICKET_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {t(`tickets.status.${status}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-theme-text-secondary">
                {t("tickets.fields.priority")}
              </span>
              <select
                className={inputClass}
                value={form.priority}
                onChange={(e) => setField("priority", e.target.value)}
              >
                {TICKET_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {t(`tickets.priority.${priority}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Field
            label={t("tickets.fields.due")}
            type="date"
            value={form.dueDate}
            onChange={(e) => setField("dueDate", e.target.value)}
          />
          {multiUser && (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-theme-text-secondary">
                {t("tickets.fields.assignee")}
              </span>
              <select
                className={inputClass}
                value={form.assigneeUserId}
                onChange={(e) => setField("assigneeUserId", e.target.value)}
              >
                <option value="">{t("tickets.unassigned")}</option>
                {assignees.map((person) => (
                  <option key={person.userId} value={person.userId}>
                    {person.username}
                  </option>
                ))}
              </select>
            </label>
          )}
          <ToolsSelector
            availableTools={availableTools}
            selectedTools={form.tools}
            onChange={(tools) => setField("tools", tools)}
            label={t("tickets.fields.tools")}
            description={t("tickets.fields.toolsHint")}
          />
          {!isNew && (
            <section className="flex flex-col gap-2 mt-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-theme-text-secondary">
                {t("tickets.runs.title")}
              </h3>
              {runs.length === 0 && (
                <p className="text-xs text-theme-text-secondary">
                  {t("tickets.runs.empty")}
                </p>
              )}
              {runs.map((run) => (
                <div
                  key={run.id}
                  className="rounded-lg border border-theme-modal-border p-2.5 flex flex-col gap-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-theme-text-primary">
                      {t(`tickets.runStatus.${run.status}`, run.status)}
                    </span>
                    <span className="text-[11px] text-theme-text-secondary">
                      {run.startedAt
                        ? new Date(run.startedAt).toLocaleString()
                        : ""}
                    </span>
                  </div>
                  {run.error && (
                    <p className="text-[11px] text-red-400">{run.error}</p>
                  )}
                  {run.result?.text && (
                    <p className="text-[11px] text-theme-text-secondary line-clamp-4 whitespace-pre-wrap">
                      {run.result.text}
                    </p>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="self-start"
                    onClick={() => openChat(run)}
                  >
                    <ChatText size={12} />
                    {t("tickets.openInChat")}
                  </Button>
                </div>
              ))}
            </section>
          )}
        </div>
        <footer className="px-5 py-4 border-t border-theme-modal-border flex flex-wrap gap-2">
          <Button onClick={save} loading={saving}>
            {isNew ? t("tickets.create") : t("tickets.save")}
          </Button>
          {!isNew && (
            <Button
              variant="outline"
              disabled={running || starting}
              loading={starting}
              onClick={() => onStart?.(ticket)}
            >
              <Play size={12} weight="fill" />
              {running ? t("tickets.running") : t("tickets.start")}
            </Button>
          )}
          {!isNew && running && ticket.latestRun?.id && (
            <Button
              variant="secondary"
              onClick={() => onKill?.(ticket.latestRun)}
            >
              <Stop size={12} />
              {t("tickets.stop")}
            </Button>
          )}
          {!isNew && (
            <Button variant="destructive" onClick={remove}>
              <Trash size={12} />
              {t("tickets.delete")}
            </Button>
          )}
        </footer>
      </aside>
    </div>
  );
}

function formFromTicket(ticket, workspaces) {
  return {
    title: ticket?.title || "",
    description: ticket?.description || "",
    workspaceId: ticket?.workspaceId || workspaces?.[0]?.id || "",
    status: ticket?.status || "todo",
    priority: ticket?.priority || "none",
    dueDate: dueInputValue(ticket?.dueDate),
    tools: Array.isArray(ticket?.tools) ? ticket.tools : [],
    assigneeUserId: ticket?.assigneeUserId || "",
  };
}
