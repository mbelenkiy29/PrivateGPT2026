const { EmbedChats } = require("../models/embedChats");
const { EmbedConfig } = require("../models/embedConfig");
const { EmbedLead } = require("../models/embedLead");
const { EmbedHandoff } = require("../models/embedHandoff");
const { EmbedUnanswered } = require("../models/embedUnanswered");
const { EventLogs } = require("../models/eventLogs");
const { reqBody, userFromSession } = require("../utils/http");
const { validEmbedConfigId } = require("../utils/middleware/embedMiddleware");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  chatHistoryViewable,
} = require("../utils/middleware/chatHistoryViewable");

const adminListMiddleware = [
  chatHistoryViewable,
  validatedRequest,
  flexUserRoleValid([ROLES.admin]),
];

async function listEmbedRows(model, request, response, key) {
  const { offset = 0, limit = 20 } = reqBody(request);
  const take = Number(limit) > 0 ? Number(limit) : 20;
  const page = Number(offset) >= 0 ? Number(offset) : 0;
  const rows = await model.whereWithEmbed(
    {},
    take,
    { id: "desc" },
    page * take
  );
  const total = await model.count();
  const hasPages = total > (page + 1) * take;
  response.status(200).json({ [key]: rows, hasPages, total });
}

function embedManagementEndpoints(app) {
  if (!app) return;

  app.get(
    "/embeds",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (_, response) => {
      try {
        const embeds = await EmbedConfig.whereWithWorkspace({}, null, {
          createdAt: "desc",
        });
        response.status(200).json({ embeds });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/embeds/new",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const user = await userFromSession(request, response);
        const data = reqBody(request);
        const { embed, message: error } = await EmbedConfig.new(data, user?.id);
        await EventLogs.logEvent(
          "embed_created",
          { embedId: embed.id },
          user?.id
        );
        response.status(200).json({ embed, error });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/embed/update/:embedId",
    [validatedRequest, flexUserRoleValid([ROLES.admin]), validEmbedConfigId],
    async (request, response) => {
      try {
        const user = await userFromSession(request, response);
        const { embedId } = request.params;
        const updates = reqBody(request);
        const { success, error } = await EmbedConfig.update(embedId, updates);
        await EventLogs.logEvent("embed_updated", { embedId }, user?.id);
        response.status(200).json({ success, error });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );

  app.delete(
    "/embed/:embedId",
    [validatedRequest, flexUserRoleValid([ROLES.admin]), validEmbedConfigId],
    async (request, response) => {
      try {
        const { embedId } = request.params;
        await EmbedConfig.delete({ id: Number(embedId) });
        await EventLogs.logEvent(
          "embed_deleted",
          { embedId },
          response?.locals?.user?.id
        );
        response.status(200).json({ success: true, error: null });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );

  app.post("/embed/chats", adminListMiddleware, async (request, response) => {
    try {
      const { offset = 0, limit = 20 } = reqBody(request);
      const embedChats = await EmbedChats.whereWithEmbedAndWorkspace(
        {},
        limit,
        { id: "desc" },
        offset * limit
      );
      const totalChats = await EmbedChats.count();
      const hasPages = totalChats > (offset + 1) * limit;
      response.status(200).json({ chats: embedChats, hasPages, totalChats });
    } catch (e) {
      console.error(e);
      response.sendStatus(500).end();
    }
  });

  app.delete(
    "/embed/chats/:chatId",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const { chatId } = request.params;
        await EmbedChats.delete({ id: Number(chatId) });
        response.status(200).json({ success: true, error: null });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );

  app.post("/embed/leads", adminListMiddleware, async (request, response) => {
    try {
      await listEmbedRows(EmbedLead, request, response, "leads");
    } catch (e) {
      console.error(e);
      response.sendStatus(500).end();
    }
  });

  app.post(
    "/embed/handoffs",
    adminListMiddleware,
    async (request, response) => {
      try {
        await listEmbedRows(EmbedHandoff, request, response, "handoffs");
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/embed/unanswered",
    adminListMiddleware,
    async (request, response) => {
      try {
        await listEmbedRows(EmbedUnanswered, request, response, "unanswered");
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );
}

module.exports = { embedManagementEndpoints };
