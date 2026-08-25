const prisma = require("../utils/prisma");
const { safeJsonParse } = require("../utils/http");

const TicketRun = {
  statuses: {
    queued: "queued",
    running: "running",
    completed: "completed",
    failed: "failed",
    timed_out: "timed_out",
    killed: "killed",
  },
  nonTerminalStatuses: ["queued", "running"],

  serialize: function (run) {
    if (!run) return null;
    return {
      ...run,
      result: safeJsonParse(run.result, run.result ?? null),
    };
  },

  /**
   * Claim a new run for a ticket. At most one in-flight run per ticket.
   * @param {number} ticketId
   * @param {{ threadId?: number|null, invocationUuid?: string|null }} [extra]
   * @returns {Promise<object|null>}
   */
  start: async function (ticketId, extra = {}) {
    try {
      return await prisma.$transaction(async (tx) => {
        const existing = await tx.ticket_runs.findFirst({
          where: {
            ticketId: Number(ticketId),
            status: { in: this.nonTerminalStatuses },
          },
          select: { id: true },
        });
        if (existing) return null;

        return tx.ticket_runs.create({
          data: {
            ticketId: Number(ticketId),
            status: this.statuses.queued,
            threadId: extra.threadId != null ? Number(extra.threadId) : null,
            invocationUuid: extra.invocationUuid || null,
          },
        });
      });
    } catch (error) {
      console.error("Failed to enqueue ticket run:", error.message);
      return null;
    }
  },

  markRunning: async function (id) {
    try {
      const result = await prisma.ticket_runs.updateMany({
        where: { id: Number(id), status: this.statuses.queued },
        data: {
          status: this.statuses.running,
          startedAt: new Date(),
        },
      });
      return result.count > 0;
    } catch (error) {
      console.error("Failed to mark ticket run running:", error.message);
      return false;
    }
  },

  failIfNotTerminal: async function (id, errorMsg) {
    try {
      const result = await prisma.ticket_runs.updateMany({
        where: {
          id: Number(id),
          status: { in: this.nonTerminalStatuses },
        },
        data: {
          status: this.statuses.failed,
          error: String(errorMsg || "Worker exited unexpectedly"),
          completedAt: new Date(),
        },
      });
      return result.count > 0;
    } catch (error) {
      console.error("Failed to fail ticket run:", error.message);
      return false;
    }
  },

  complete: async function (id, { result } = {}) {
    try {
      const run = await prisma.ticket_runs.update({
        where: { id: Number(id) },
        data: {
          status: this.statuses.completed,
          result: typeof result === "string" ? result : JSON.stringify(result),
          completedAt: new Date(),
        },
      });
      return run;
    } catch (error) {
      console.error("Failed to complete ticket run:", error.message);
      return null;
    }
  },

  fail: async function (id, { error: errorMsg } = {}) {
    try {
      const result = await prisma.ticket_runs.updateMany({
        where: {
          id: Number(id),
          status: { in: this.nonTerminalStatuses },
        },
        data: {
          status: this.statuses.failed,
          error: String(errorMsg || "Unknown error"),
          completedAt: new Date(),
        },
      });
      if (result.count === 0) return null;
      return await this.get({ id: Number(id) });
    } catch (error) {
      console.error("Failed to mark ticket run failed:", error.message);
      return null;
    }
  },

  timeout: async function (id) {
    try {
      const result = await prisma.ticket_runs.updateMany({
        where: {
          id: Number(id),
          status: { in: this.nonTerminalStatuses },
        },
        data: {
          status: this.statuses.timed_out,
          error: "Ticket execution timed out",
          completedAt: new Date(),
        },
      });
      if (result.count === 0) return null;
      return await this.get({ id: Number(id) });
    } catch (error) {
      console.error("Failed to mark ticket run timed out:", error.message);
      return null;
    }
  },

  kill: async function (id) {
    try {
      const result = await prisma.ticket_runs.updateMany({
        where: {
          id: Number(id),
          status: { in: this.nonTerminalStatuses },
        },
        data: {
          status: this.statuses.killed,
          error: "Run stopped by user",
          completedAt: new Date(),
        },
      });
      if (result.count === 0) return null;
      return await this.get({ id: Number(id) });
    } catch (error) {
      console.error("Failed to kill ticket run:", error.message);
      return null;
    }
  },

  failOrphanedRuns: async function () {
    try {
      const result = await prisma.ticket_runs.updateMany({
        where: { status: { in: this.nonTerminalStatuses } },
        data: {
          status: this.statuses.failed,
          error: "Server restarted during execution",
          completedAt: new Date(),
        },
      });
      return result.count;
    } catch (error) {
      console.error("Failed to fail orphaned ticket runs:", error.message);
      return 0;
    }
  },

  get: async function (clause = {}, include = {}) {
    try {
      const run = await prisma.ticket_runs.findFirst({
        where: clause,
        ...(Object.keys(include).length ? { include } : {}),
      });
      return this.serialize(run);
    } catch (error) {
      console.error("Failed to get ticket run:", error.message);
      return null;
    }
  },

  where: async function (clause = {}, limit = 50, orderBy = null) {
    try {
      const results = await prisma.ticket_runs.findMany({
        where: clause,
        ...(limit != null ? { take: limit } : {}),
        orderBy: orderBy || { startedAt: "desc" },
      });
      return results.map((run) => this.serialize(run));
    } catch (error) {
      console.error("Failed to query ticket runs:", error.message);
      return [];
    }
  },

  /**
   * Write the completed run into its workspace thread so "Open in chat" works.
   */
  portToThread: async function (runId) {
    try {
      const { WorkspaceChats } = require("./workspaceChats");
      const { Ticket } = require("./ticket");

      const run = await prisma.ticket_runs.findFirst({
        where: { id: Number(runId) },
      });
      if (!run?.threadId) return false;

      const ticket = await Ticket.get({ id: run.ticketId });
      if (!ticket) return false;

      const result = safeJsonParse(run.result, {});
      await WorkspaceChats.new({
        workspaceId: ticket.workspaceId,
        prompt: Ticket.buildPrompt(ticket),
        response: {
          text: result?.text || run.error || "No response was generated.",
          sources: result.sources || [],
          outputs: result.outputs || [],
          type: "chat",
        },
        threadId: run.threadId,
        include: true,
      });
      return true;
    } catch (error) {
      console.error("Failed to port ticket run to thread:", error.message);
      return false;
    }
  },

  continueInThread: async function (runId) {
    try {
      const { Workspace } = require("./workspace");
      const { WorkspaceThread } = require("./workspaceThread");
      const { WorkspaceChats } = require("./workspaceChats");
      const { Ticket } = require("./ticket");

      const run = await prisma.ticket_runs.findFirst({
        where: { id: Number(runId) },
      });
      if (!run) throw new Error("Run not found");

      const ticket = await prisma.tickets.findFirst({
        where: { id: run.ticketId },
        include: { workspace: true },
      });
      if (!ticket?.workspace) throw new Error("Ticket workspace not found");

      let thread = null;
      if (run.threadId) {
        thread = await WorkspaceThread.get({ id: run.threadId });
      }

      if (!thread) {
        const created = await WorkspaceThread.new(ticket.workspace, null, {
          name: ticket.title || "Ticket",
        });
        if (created.message)
          throw new Error(created.message || "Failed to create thread");
        thread = created.thread;
        await prisma.ticket_runs.update({
          where: { id: run.id },
          data: { threadId: thread.id },
        });

        const result = safeJsonParse(run.result, {});
        await WorkspaceChats.new({
          workspaceId: ticket.workspace.id,
          prompt: Ticket.buildPrompt(ticket),
          response: {
            text: result?.text || run.error || "No response was generated.",
            sources: result.sources || [],
            outputs: result.outputs || [],
            type: "chat",
          },
          threadId: thread.id,
          include: true,
        });
      }

      const workspace = await Workspace.get({ id: ticket.workspace.id });
      return { workspace, thread, error: null };
    } catch (error) {
      return {
        workspace: null,
        thread: null,
        error: error.message ?? "Unknown error",
      };
    }
  },
};

module.exports = { TicketRun };
