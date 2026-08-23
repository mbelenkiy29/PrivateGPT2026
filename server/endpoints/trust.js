const { EventLogs } = require("../models/eventLogs");
const { EmbedChats } = require("../models/embedChats");
const { Memory } = require("../models/memory");
const { SystemSettings } = require("../models/systemSettings");
const { UsageEvent } = require("../models/usageEvent");
const { User } = require("../models/user");
const { WorkspaceChats } = require("../models/workspaceChats");
const { reqBody, userFromSession } = require("../utils/http");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { validatedRequest } = require("../utils/middleware/validatedRequest");

function startOfUtcMonth(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function parseUserId(raw) {
  const userId = Number(raw);
  if (!Number.isInteger(userId) || userId <= 0) return null;
  return userId;
}

function trustEndpoints(app) {
  if (!app) return;

  app.get(
    "/trust/summary",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (_request, response) => {
      try {
        const since = startOfUtcMonth();
        const summary = await UsageEvent.monthlySummary({ since });
        const retentionDays = await SystemSettings.chatRetentionDays();
        response.status(200).json({
          period: { since: since.toISOString() },
          ...summary,
          retention_days: retentionDays,
        });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );

  app.get(
    "/trust/export/:userId",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const userId = parseUserId(request.params.userId);
        if (!userId)
          return response.status(400).json({ error: "Invalid user id." });

        const user = await User.get({ id: userId });
        if (!user)
          return response.status(404).json({ error: "User not found." });

        const [chats, memories, embedChats] = await Promise.all([
          WorkspaceChats.where({ user_id: userId }),
          Memory.where({ userId }),
          EmbedChats.where({ usersId: userId }),
        ]);

        const actor = await userFromSession(request, response);
        await EventLogs.logEvent(
          "user_data_exported",
          { userId },
          actor?.id ?? null
        );

        response.status(200).json({
          exportedAt: new Date().toISOString(),
          user,
          chats,
          memories,
          embedChats,
        });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );

  app.delete(
    "/trust/user/:userId/data",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const userId = parseUserId(request.params.userId);
        if (!userId)
          return response.status(400).json({ error: "Invalid user id." });

        const user = await User.get({ id: userId });
        if (!user)
          return response.status(404).json({ error: "User not found." });

        await WorkspaceChats.delete({ user_id: userId });
        await Memory.deleteMany({ userId });
        await EmbedChats.delete({ usersId: userId });

        const actor = await userFromSession(request, response);
        await EventLogs.logEvent(
          "user_data_deleted",
          { userId },
          actor?.id ?? null
        );

        response.status(200).json({ success: true, userId });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );

  app.put(
    "/trust/retention",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const { days } = reqBody(request);
        const parsed = Number(days);
        if (!Number.isFinite(parsed) || parsed < 0) {
          return response.status(400).json({
            error: "days must be a number >= 0 (0 = keep forever).",
          });
        }

        const value = Math.floor(parsed);
        const { success, error } = await SystemSettings._updateSettings({
          chat_retention_days: value,
        });
        if (!success)
          return response.status(400).json({ error: error || "Update failed." });

        response.status(200).json({
          success: true,
          days: value,
        });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );
}

module.exports = { trustEndpoints };
