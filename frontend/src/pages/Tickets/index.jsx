import { useCallback, useEffect, useMemo, useState } from "react";
import { isMobile } from "react-device-detect";
import { useTranslation } from "react-i18next";
import { Kanban, Plus, Table } from "@phosphor-icons/react";
import Sidebar, { SidebarMobileHeader } from "@/components/Sidebar";
import PasswordModal, { usePasswordModal } from "@/components/Modals/Password";
import { FullScreenLoader } from "@/components/Preloader";
import {
  Button,
  EmptyState,
  LoadingState,
  PillTabs,
  SearchInput,
} from "@/components/ui/21st";
import Tickets from "@/models/tickets";
import Workspace from "@/models/workspace";
import showToast from "@/utils/toast";
import usePolling from "@/hooks/usePolling";
import { LAST_VISITED_WORKSPACE } from "@/utils/constants";
import { safeJsonParse } from "@/utils/request";
import BoardView from "./BoardView";
import TableView from "./TableView";
import TicketDrawer from "./TicketDrawer";
import { isActiveRun } from "./constants";

export default function TicketsPage() {
  const { loading, requiresAuth, mode } = usePasswordModal();

  if (loading) return <FullScreenLoader />;
  if (requiresAuth !== false) {
    return <>{requiresAuth !== null && <PasswordModal mode={mode} />}</>;
  }

  return (
    <div className="w-screen h-screen overflow-hidden bg-zinc-950 light:bg-slate-50 flex">
      {!isMobile ? <Sidebar /> : <SidebarMobileHeader />}
      <TicketsBoard />
    </div>
  );
}

function TicketsBoard() {
  const { t } = useTranslation();
  const [view, setView] = useState("board");
  const [query, setQuery] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [tickets, setTickets] = useState([]);
  const [workspaces, setWorkspaces] = useState([]);
  const [availableTools, setAvailableTools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drawerTicket, setDrawerTicket] = useState(null);
  const [startingId, setStartingId] = useState(null);

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setLoading(true);
      const [{ tickets: rows }, list, tools] = await Promise.all([
        Tickets.list({
          workspaceId: workspaceId || undefined,
        }),
        Workspace.all(),
        Tickets.availableTools(),
      ]);
      setTickets(rows || []);
      setWorkspaces(list || []);
      setAvailableTools(tools?.tools || []);
      setDrawerTicket((current) => {
        if (!current?.id) return current;
        const next = (rows || []).find((item) => item.id === current.id);
        if (!next) return current;
        return {
          ...current,
          status: next.status,
          position: next.position,
          latestRun: next.latestRun,
          assignee: next.assignee,
          workspace: next.workspace,
        };
      });
      if (!silent) setLoading(false);
    },
    [workspaceId]
  );

  useEffect(() => {
    load();
  }, [load]);

  const hasActive = tickets.some(isActiveRun);
  usePolling(() => load({ silent: true }), 4000, hasActive);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tickets;
    return tickets.filter((ticket) => {
      const hay = [
        ticket.title,
        ticket.description,
        ticket.workspace?.name,
        ticket.assignee?.username,
        ...(ticket.tools || []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [tickets, query]);

  const defaultWorkspaceId = () => {
    if (workspaceId) return workspaceId;
    const last = safeJsonParse(localStorage.getItem(LAST_VISITED_WORKSPACE));
    const match = workspaces.find((ws) => ws.slug === last?.slug);
    return match?.id || workspaces[0]?.id;
  };

  const upsert = async (next) => {
    setDrawerTicket(next);
    await load({ silent: true });
  };

  const handleMove = async (ticket, payload) => {
    const { ticket: updated, error } = await Tickets.move(ticket.id, payload);
    if (error || !updated) {
      showToast(error || t("tickets.errors.moveFailed"), "error");
      return;
    }
    setTickets((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item))
    );
    if (drawerTicket?.id === updated.id) setDrawerTicket(updated);
  };

  const handleStart = async (ticket) => {
    setStartingId(ticket.id);
    const result = await Tickets.start(ticket.id);
    setStartingId(null);
    if (!result.success) {
      showToast(
        result.error || t("tickets.errors.startFailed"),
        result.skipped ? "info" : "error"
      );
    } else {
      showToast(t("tickets.toast.started"), "success", { clear: true });
    }
    await load({ silent: true });
  };

  const handleKill = async (run) => {
    const result = await Tickets.killRun(run.id);
    if (!result.success) {
      showToast(result.error || t("tickets.errors.stopFailed"), "error");
      return;
    }
    showToast(t("tickets.toast.stopped"), "success", { clear: true });
    await load({ silent: true });
  };

  return (
    <div className="flex-1 min-w-0 h-full overflow-hidden flex flex-col px-4 md:px-6 py-4 gap-4">
      <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-theme-text-primary">
            {t("tickets.title")}
          </h1>
          <p className="text-xs text-theme-text-secondary mt-0.5">
            {t("tickets.subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            className="w-[200px]"
            placeholder={t("tickets.search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
            className="h-8 rounded-lg border border-theme-modal-border bg-theme-settings-input-bg px-2 text-xs text-theme-text-primary"
          >
            <option value="">{t("tickets.allWorkspaces")}</option>
            {workspaces.map((ws) => (
              <option key={ws.id} value={ws.id}>
                {ws.name}
              </option>
            ))}
          </select>
          <PillTabs
            value={view}
            onChange={setView}
            items={[
              {
                value: "board",
                label: t("tickets.views.board"),
                icon: <Kanban size={12} />,
              },
              {
                value: "table",
                label: t("tickets.views.table"),
                icon: <Table size={12} />,
              },
            ]}
          />
          <Button
            size="sm"
            onClick={() =>
              setDrawerTicket({
                workspaceId: defaultWorkspaceId(),
              })
            }
          >
            <Plus size={14} />
            {t("tickets.new")}
          </Button>
        </div>
      </header>

      {loading ? (
        <LoadingState
          className="flex-1 rounded-2xl border border-dashed border-theme-modal-border bg-theme-settings-input-bg/30"
          variant="drive"
          size="page"
          label={t("common.loading")}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          className="flex-1"
          title={t("tickets.empty.title")}
          description={t("tickets.empty.description")}
          icons={[<Kanban key="a" />, <Table key="b" />, <Plus key="c" />]}
          action={{
            label: t("tickets.new"),
            icon: <Plus size={14} />,
            onClick: () =>
              setDrawerTicket({
                workspaceId: defaultWorkspaceId(),
              }),
          }}
        />
      ) : view === "board" ? (
        <BoardView
          tickets={filtered}
          onOpen={setDrawerTicket}
          onStart={handleStart}
          onMove={handleMove}
          startingId={startingId}
        />
      ) : (
        <TableView
          tickets={filtered}
          onOpen={setDrawerTicket}
          onStart={handleStart}
          onMove={handleMove}
          startingId={startingId}
        />
      )}

      {drawerTicket && (
        <TicketDrawer
          ticket={drawerTicket}
          workspaces={workspaces}
          availableTools={availableTools}
          onClose={() => setDrawerTicket(null)}
          onSaved={upsert}
          onDeleted={(removed) => {
            setTickets((prev) => prev.filter((item) => item.id !== removed.id));
            setDrawerTicket(null);
          }}
          onStart={handleStart}
          onKill={handleKill}
          starting={startingId === drawerTicket.id}
        />
      )}
    </div>
  );
}
