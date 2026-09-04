const { Ticket } = require("../models/ticket");
const { TicketRun } = require("../models/ticketRun");
const { Workspace } = require("../models/workspace");
const { WorkspaceUser } = require("../models/workspaceUsers");
const { WorkspaceThread } = require("../models/workspaceThread");
const { ScheduledJob } = require("../models/scheduledJob");
const { SystemSettings } = require("../models/systemSettings");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { reqBody, userFromSession } = require("../utils/http");
const { BackgroundService } = require("../utils/BackgroundWorkers");

const backgroundService = new BackgroundService();
const ACTIVE_RUN = ["queued", "running"];

function isPrivileged(user) {
  return user?.role === ROLES.admin || user?.role === ROLES.manager;
}

async function memberWorkspaceIds(user) {
  if (!user?.id) return [];
  const rels = await WorkspaceUser.where({ user_id: Number(user.id) });
  return rels.map((rel) => rel.workspace_id);
}

async function canAccessWorkspace(user, multiUser, workspaceId) {
  if (!multiUser || !user || isPrivileged(user)) return true;
  const ids = await memberWorkspaceIds(user);
  return ids.includes(Number(workspaceId));
}

async function listScope(user, multiUser, organizationId = null) {
  const tenantClause = organizationId
    ? { organizationId: Number(organizationId) }
    : {};
  if (!multiUser || !user || isPrivileged(user)) return tenantClause;
  const ids = await memberWorkspaceIds(user);
  return {
    workspaceId: { in: ids.length ? ids : [-1] },
    ...tenantClause,
  };
}

function ticketEndpoints(app) {
  if (!app) return;

  app.get(
    "/tickets/available-tools",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (_request, response) => {
      try {
        const tools = await ScheduledJob.availableTools();
        return response.status(200).json({ tools });
      } catch (e) {
        console.error(e.message, e);
        return response.status(500).json({ tools: [] });
      }
    }
  );

  app.get(
    "/tickets/assignees",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const multiUser = await SystemSettings.isMultiUserMode();
        if (!multiUser) {
          return response.status(200).json({ assignees: [], multiUser: false });
        }

        const workspaceId = Number(request.query.workspaceId);
        if (!Number.isInteger(workspaceId) || workspaceId <= 0) {
          return response.status(400).json({
            assignees: [],
            multiUser: true,
            error: "workspaceId required",
          });
        }

        const user = await userFromSession(request, response);
        const allowed = await canAccessWorkspace(user, true, workspaceId);
        if (!allowed) return response.sendStatus(403);

        const assignees = await Workspace.workspaceUsers(workspaceId);
        return response.status(200).json({ assignees, multiUser: true });
      } catch (e) {
        console.error(e.message, e);
        return response.status(500).json({ assignees: [], multiUser: true });
      }
    }
  );

  app.get(
    "/tickets",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const user = await userFromSession(request, response);
        const multiUser = await SystemSettings.isMultiUserMode();
        const scope = await listScope(
          user,
          multiUser,
          response.locals?.tenantId
        );
        const clause = { ...scope };

        const workspaceId = Number(request.query.workspaceId);
        if (Number.isInteger(workspaceId) && workspaceId > 0) {
          const allowed = await canAccessWorkspace(
            user,
            multiUser,
            workspaceId
          );
          if (!allowed) return response.sendStatus(403);
          clause.workspaceId = workspaceId;
        }

        if (
          request.query.status &&
          Ticket.statuses.includes(request.query.status)
        ) {
          clause.status = request.query.status;
        }

        const q = String(request.query.q || "").trim();
        if (q) {
          clause.title = { contains: q };
        }

        const tickets = await Ticket.where(clause);
        return response.status(200).json({ tickets });
      } catch (e) {
        console.error(e.message, e);
        return response.status(500).json({ tickets: [] });
      }
    }
  );

  app.post(
    "/tickets",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const body = reqBody(request);
        const user = await userFromSession(request, response);
        const multiUser = await SystemSettings.isMultiUserMode();
        const workspace = await Workspace.get({ id: Number(body.workspaceId) });
        if (!workspace) {
          return response
            .status(400)
            .json({ ticket: null, error: "Workspace not found" });
        }

        const allowed = await canAccessWorkspace(user, multiUser, workspace.id);
        if (!allowed) return response.sendStatus(403);

        const { ticket, error } = await Ticket.create({
          ...body,
          createdByUserId: user?.id || null,
        });
        if (error) return response.status(400).json({ ticket: null, error });
        return response.status(200).json({ ticket, error: null });
      } catch (e) {
        console.error(e.message, e);
        return response.status(500).json({ ticket: null, error: e.message });
      }
    }
  );

  app.get(
    "/tickets/:id",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const ticket = await Ticket.get({ id: Number(request.params.id) });
        if (!ticket) return response.status(404).json({ ticket: null });

        const user = await userFromSession(request, response);
        const multiUser = await SystemSettings.isMultiUserMode();
        const allowed = await canAccessWorkspace(
          user,
          multiUser,
          ticket.workspaceId
        );
        if (!allowed) return response.sendStatus(403);

        const runs = await TicketRun.where({ ticketId: ticket.id }, 25);
        return response.status(200).json({ ticket, runs });
      } catch (e) {
        console.error(e.message, e);
        return response.sendStatus(500);
      }
    }
  );

  app.patch(
    "/tickets/:id",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const existing = await Ticket.get({ id: Number(request.params.id) });
        if (!existing)
          return response
            .status(404)
            .json({ ticket: null, error: "Not found" });

        const user = await userFromSession(request, response);
        const multiUser = await SystemSettings.isMultiUserMode();
        const allowed = await canAccessWorkspace(
          user,
          multiUser,
          existing.workspaceId
        );
        if (!allowed) return response.sendStatus(403);

        const body = reqBody(request);
        if (
          body.workspaceId &&
          Number(body.workspaceId) !== existing.workspaceId
        ) {
          const nextAllowed = await canAccessWorkspace(
            user,
            multiUser,
            body.workspaceId
          );
          if (!nextAllowed) return response.sendStatus(403);
        }

        const { ticket, error } = await Ticket.update(existing.id, body);
        if (error) return response.status(400).json({ ticket: null, error });
        return response.status(200).json({ ticket, error: null });
      } catch (e) {
        console.error(e.message, e);
        return response.status(500).json({ ticket: null, error: e.message });
      }
    }
  );

  app.delete(
    "/tickets/:id",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const existing = await Ticket.get({ id: Number(request.params.id) });
        if (!existing) return response.status(404).json({ success: false });

        const user = await userFromSession(request, response);
        const multiUser = await SystemSettings.isMultiUserMode();
        const allowed = await canAccessWorkspace(
          user,
          multiUser,
          existing.workspaceId
        );
        if (!allowed) return response.sendStatus(403);

        if (ACTIVE_RUN.includes(existing.latestRun?.status)) {
          backgroundService.killTicketRun(existing.id, existing.latestRun.id);
          await TicketRun.kill(existing.latestRun.id);
        }

        const success = await Ticket.delete(existing.id);
        return response.status(200).json({ success });
      } catch (e) {
        console.error(e.message, e);
        return response.status(500).json({ success: false });
      }
    }
  );

  app.post(
    "/tickets/:id/move",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const existing = await Ticket.get({ id: Number(request.params.id) });
        if (!existing)
          return response
            .status(404)
            .json({ ticket: null, error: "Not found" });

        const user = await userFromSession(request, response);
        const multiUser = await SystemSettings.isMultiUserMode();
        const allowed = await canAccessWorkspace(
          user,
          multiUser,
          existing.workspaceId
        );
        if (!allowed) return response.sendStatus(403);

        const { status, position } = reqBody(request);
        const { ticket, error } = await Ticket.move(existing.id, {
          status,
          position,
        });
        if (error) return response.status(400).json({ ticket: null, error });
        return response.status(200).json({ ticket, error: null });
      } catch (e) {
        console.error(e.message, e);
        return response.status(500).json({ ticket: null, error: e.message });
      }
    }
  );

  app.post(
    "/tickets/:id/start",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const existing = await Ticket.get({ id: Number(request.params.id) });
        if (!existing)
          return response
            .status(404)
            .json({ success: false, error: "Not found" });

        const user = await userFromSession(request, response);
        const multiUser = await SystemSettings.isMultiUserMode();
        const allowed = await canAccessWorkspace(
          user,
          multiUser,
          existing.workspaceId
        );
        if (!allowed) return response.sendStatus(403);

        if (ACTIVE_RUN.includes(existing.latestRun?.status)) {
          return response.status(200).json({
            success: false,
            skipped: true,
            run: existing.latestRun,
            error: "A run is already in progress for this ticket",
          });
        }

        if (!existing.workspaceId) {
          return response.status(400).json({
            success: false,
            error: "Ticket is missing a workspace",
          });
        }

        const workspace = await Workspace.get({ id: existing.workspaceId });
        if (!workspace) {
          return response.status(400).json({
            success: false,
            error: "Workspace not found",
          });
        }

        const { thread, message: threadError } = await WorkspaceThread.new(
          workspace,
          user?.id || existing.assigneeUserId || null,
          { name: existing.title || "Ticket" }
        );
        if (threadError) {
          return response.status(500).json({
            success: false,
            error: threadError,
          });
        }

        if (existing.status !== "in_progress") {
          await Ticket.update(existing.id, { status: "in_progress" });
        }

        const run = await backgroundService.enqueueTicket(existing.id, {
          threadId: thread.id,
        });
        return response.status(200).json({
          success: !!run,
          skipped: !run,
          run: run ? TicketRun.serialize(run) : null,
          threadSlug: thread.slug,
          workspaceSlug: workspace.slug,
          error: run ? null : "A run is already in progress for this ticket",
        });
      } catch (e) {
        console.error(e.message, e);
        return response.status(500).json({ success: false, error: e.message });
      }
    }
  );

  app.get(
    "/tickets/:id/runs",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const existing = await Ticket.get({ id: Number(request.params.id) });
        if (!existing) return response.status(404).json({ runs: [] });

        const user = await userFromSession(request, response);
        const multiUser = await SystemSettings.isMultiUserMode();
        const allowed = await canAccessWorkspace(
          user,
          multiUser,
          existing.workspaceId
        );
        if (!allowed) return response.sendStatus(403);

        const runs = await TicketRun.where({ ticketId: existing.id }, 50);
        return response.status(200).json({ runs });
      } catch (e) {
        console.error(e.message, e);
        return response.status(500).json({ runs: [] });
      }
    }
  );

  app.post(
    "/tickets/runs/:runId/kill",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const run = await TicketRun.get({
          id: Number(request.params.runId),
        });
        if (!run)
          return response
            .status(404)
            .json({ success: false, error: "Not found" });

        const ticket = await Ticket.get({ id: run.ticketId });
        if (!ticket)
          return response
            .status(404)
            .json({ success: false, error: "Not found" });

        const user = await userFromSession(request, response);
        const multiUser = await SystemSettings.isMultiUserMode();
        const allowed = await canAccessWorkspace(
          user,
          multiUser,
          ticket.workspaceId
        );
        if (!allowed) return response.sendStatus(403);

        if (!ACTIVE_RUN.includes(run.status)) {
          return response.status(400).json({
            success: false,
            error: "Only queued or running tickets can be stopped",
          });
        }

        const killed = backgroundService.killTicketRun(ticket.id, run.id);
        if (!killed) await TicketRun.kill(run.id);
        return response.status(200).json({ success: true });
      } catch (e) {
        console.error(e.message, e);
        return response.status(500).json({ success: false, error: e.message });
      }
    }
  );

  app.post(
    "/tickets/runs/:runId/continue",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const run = await TicketRun.get({
          id: Number(request.params.runId),
        });
        if (!run) return response.status(404).json({ error: "Run not found" });

        const ticket = await Ticket.get({ id: run.ticketId });
        if (!ticket) return response.status(404).json({ error: "Not found" });

        const user = await userFromSession(request, response);
        const multiUser = await SystemSettings.isMultiUserMode();
        const allowed = await canAccessWorkspace(
          user,
          multiUser,
          ticket.workspaceId
        );
        if (!allowed) return response.sendStatus(403);

        const { workspace, thread, error } = await TicketRun.continueInThread(
          run.id
        );
        if (error) return response.status(500).json({ error });
        return response.status(200).json({
          workspaceSlug: workspace.slug,
          threadSlug: thread.slug,
        });
      } catch (e) {
        console.error(e.message, e);
        return response.status(500).json({ error: e.message });
      }
    }
  );
}

module.exports = { ticketEndpoints };
