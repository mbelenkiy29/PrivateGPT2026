const prisma = require("../utils/prisma");
const { safeJsonParse } = require("../utils/http");

const STATUSES = ["backlog", "todo", "in_progress", "done", "cancelled"];
const PRIORITIES = ["none", "low", "medium", "high", "urgent"];

const defaultInclude = {
  workspace: { select: { id: true, name: true, slug: true } },
  assignee: { select: { id: true, username: true, pfpFilename: true } },
  runs: { orderBy: { startedAt: "desc" }, take: 1 },
};

function serializeRun(run) {
  if (!run) return null;
  return {
    ...run,
    result: safeJsonParse(run.result, run.result ?? null),
  };
}

function serialize(ticket) {
  if (!ticket) return null;
  const { runs, assignee, createdBy, workspace, ...rest } = ticket;
  return {
    ...rest,
    tools: Array.isArray(ticket.tools)
      ? ticket.tools
      : safeJsonParse(ticket.tools, []),
    properties:
      ticket.properties && typeof ticket.properties === "object"
        ? ticket.properties
        : safeJsonParse(ticket.properties, {}),
    workspace: workspace
      ? {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
        }
      : null,
    assignee: assignee
      ? {
          id: assignee.id,
          username: assignee.username,
          pfpFilename: assignee.pfpFilename || null,
        }
      : null,
    createdBy: createdBy
      ? {
          id: createdBy.id,
          username: createdBy.username,
        }
      : null,
    latestRun: serializeRun(Array.isArray(runs) ? runs[0] : null),
  };
}

const Ticket = {
  statuses: STATUSES,
  priorities: PRIORITIES,
  writable: [
    "title",
    "description",
    "status",
    "priority",
    "position",
    "dueDate",
    "tools",
    "properties",
    "assigneeUserId",
    "workspaceId",
  ],

  serialize,

  validations: {
    title: (value) => {
      const title = String(value || "").trim();
      if (!title) throw new Error("Title is required");
      return title.slice(0, 255);
    },
    description: (value) => {
      if (value == null) return "";
      return String(value).slice(0, 20000);
    },
    status: (value) => {
      if (value == null || value === "") return "todo";
      if (!STATUSES.includes(value)) throw new Error("Invalid status");
      return value;
    },
    priority: (value) => {
      if (value == null || value === "") return "none";
      if (!PRIORITIES.includes(value)) throw new Error("Invalid priority");
      return value;
    },
    position: (value) => {
      if (value == null || value === "") return null;
      const num = Number(value);
      if (!Number.isFinite(num)) throw new Error("Invalid position");
      return num;
    },
    dueDate: (value) => {
      if (value == null || value === "") return null;
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) throw new Error("Invalid due date");
      return date;
    },
    tools: (value) => {
      if (value == null) return null;
      if (!Array.isArray(value)) throw new Error("Tools must be an array");
      return value.map((id) => String(id)).filter(Boolean);
    },
    properties: (value) => {
      if (value == null) return null;
      if (typeof value !== "object" || Array.isArray(value))
        throw new Error("Properties must be an object");
      return value;
    },
    assigneeUserId: (value) => {
      if (value == null || value === "") return null;
      const id = Number(value);
      if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid assignee");
      return id;
    },
    workspaceId: (value) => {
      const id = Number(value);
      if (!Number.isInteger(id) || id <= 0)
        throw new Error("Workspace is required");
      return id;
    },
  },

  buildPrompt: function (ticket) {
    const title = ticket?.title || "Untitled ticket";
    const description = String(ticket?.description || "").trim();
    return [
      "You are completing a workspace ticket.",
      "",
      `Title: ${title}`,
      description ? `Description:\n${description}` : "Description: (none)",
      "",
      "Use only the tools loaded for this run. Do the work the ticket describes, then summarize what you did and what is still open.",
    ].join("\n");
  },

  nextPosition: async function (workspaceId, status) {
    try {
      const last = await prisma.tickets.findFirst({
        where: {
          workspaceId: Number(workspaceId),
          status: String(status),
        },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      return last ? Number(last.position) + 1 : 1;
    } catch (error) {
      console.error("Failed to compute ticket position:", error.message);
      return 1;
    }
  },

  create: async function (data = {}) {
    try {
      const workspaceId = this.validations.workspaceId(data.workspaceId);
      const status = this.validations.status(data.status);
      const tools = this.validations.tools(data.tools);
      const properties = this.validations.properties(data.properties);
      const position =
        this.validations.position(data.position) ??
        (await this.nextPosition(workspaceId, status));

      const ticket = await prisma.tickets.create({
        data: {
          workspaceId,
          title: this.validations.title(data.title),
          description: this.validations.description(data.description),
          status,
          priority: this.validations.priority(data.priority),
          position,
          dueDate: this.validations.dueDate(data.dueDate),
          tools: tools ? JSON.stringify(tools) : null,
          properties: properties ? JSON.stringify(properties) : null,
          assigneeUserId: this.validations.assigneeUserId(data.assigneeUserId),
          createdByUserId:
            data.createdByUserId != null
              ? this.validations.assigneeUserId(data.createdByUserId)
              : null,
        },
        include: defaultInclude,
      });
      return { ticket: serialize(ticket), error: null };
    } catch (error) {
      console.error("Failed to create ticket:", error.message);
      return { ticket: null, error: error.message };
    }
  },

  update: async function (id, data = {}) {
    try {
      const updates = {};
      for (const key of this.writable) {
        if (!Object.prototype.hasOwnProperty.call(data, key)) continue;
        if (key === "tools") {
          const tools = this.validations.tools(data.tools);
          updates.tools = tools ? JSON.stringify(tools) : null;
        } else if (key === "properties") {
          const properties = this.validations.properties(data.properties);
          updates.properties = properties ? JSON.stringify(properties) : null;
        } else {
          const validated = this.validations[key]
            ? this.validations[key](data[key])
            : data[key];
          if (key === "position" && validated == null) continue;
          updates[key] = validated;
        }
      }

      if (Object.keys(updates).length === 0) {
        const existing = await this.get({ id: Number(id) });
        return { ticket: existing, error: null };
      }

      if (updates.status && updates.position == null) {
        const current = await prisma.tickets.findFirst({
          where: { id: Number(id) },
          select: { status: true, workspaceId: true, position: true },
        });
        if (current && current.status !== updates.status) {
          updates.position = await this.nextPosition(
            current.workspaceId,
            updates.status
          );
        }
      }

      updates.lastUpdatedAt = new Date();
      const ticket = await prisma.tickets.update({
        where: { id: Number(id) },
        data: updates,
        include: defaultInclude,
      });
      return { ticket: serialize(ticket), error: null };
    } catch (error) {
      console.error("Failed to update ticket:", error.message);
      return { ticket: null, error: error.message };
    }
  },

  move: async function (id, { status, position } = {}) {
    try {
      const updates = { lastUpdatedAt: new Date() };
      if (status != null) updates.status = this.validations.status(status);
      if (position != null)
        updates.position = this.validations.position(position);

      if (updates.status && updates.position == null) {
        const current = await prisma.tickets.findFirst({
          where: { id: Number(id) },
          select: { workspaceId: true, status: true },
        });
        if (current) {
          updates.position = await this.nextPosition(
            current.workspaceId,
            updates.status
          );
        }
      }

      const ticket = await prisma.tickets.update({
        where: { id: Number(id) },
        data: updates,
        include: defaultInclude,
      });
      return { ticket: serialize(ticket), error: null };
    } catch (error) {
      console.error("Failed to move ticket:", error.message);
      return { ticket: null, error: error.message };
    }
  },

  get: async function (clause = {}, include = defaultInclude) {
    try {
      const ticket = await prisma.tickets.findFirst({
        where: clause,
        include,
      });
      return serialize(ticket);
    } catch (error) {
      console.error("Failed to get ticket:", error.message);
      return null;
    }
  },

  where: async function (clause = {}, limit = null, orderBy = null) {
    try {
      const results = await prisma.tickets.findMany({
        where: clause,
        ...(limit != null ? { take: limit } : {}),
        orderBy: orderBy || [{ status: "asc" }, { position: "asc" }],
        include: defaultInclude,
      });
      return results.map(serialize);
    } catch (error) {
      console.error("Failed to query tickets:", error.message);
      return [];
    }
  },

  delete: async function (id) {
    try {
      await prisma.tickets.delete({ where: { id: Number(id) } });
      return true;
    } catch (error) {
      console.error("Failed to delete ticket:", error.message);
      return false;
    }
  },
};

module.exports = { Ticket };
