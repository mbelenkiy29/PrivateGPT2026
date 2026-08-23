const { reqBody } = require("../../utils/http");
const { validatedRequest } = require("../../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../../utils/middleware/multiUserProtected");
const {
  acceptTeamsActivity,
  processTeamsActivity,
  publicBotConfig,
  saveBotConfig,
  disableBot,
} = require("../../utils/channelChat/teams");

function teamsChannelEndpoints(app) {
  if (!app) return;

  app.get(
    "/channels/teams/config",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const config = await publicBotConfig(request);
        response.status(200).json({ config });
      } catch (e) {
        console.error(e);
        response.status(500).json({ error: e.message });
      }
    }
  );

  app.post(
    "/channels/teams/config",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const body = reqBody(request) || {};
        const result = await saveBotConfig({
          microsoftAppId: body.microsoftAppId || body.appId || body.app_id,
          microsoftAppPassword:
            body.microsoftAppPassword || body.appPassword || body.app_password,
          tenantId: body.tenantId || body.tenant_id,
          defaultWorkspace: body.defaultWorkspace || body.default_workspace,
          active: body.active,
        });
        if (!result.success) {
          return response.status(400).json(result);
        }
        const config = await publicBotConfig(request);
        response.status(200).json({ success: true, config });
      } catch (e) {
        console.error(e);
        response.status(500).json({ success: false, error: e.message });
      }
    }
  );

  app.post(
    "/channels/teams/disconnect",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (_request, response) => {
      try {
        const result = await disableBot();
        response.status(result.success ? 200 : 500).json(result);
      } catch (e) {
        console.error(e);
        response.status(500).json({ success: false, error: e.message });
      }
    }
  );

  // Azure Bot health check (portal sometimes GETs the messaging endpoint).
  app.get("/channels/teams/messages", (_request, response) => {
    response.status(200).json({ ok: true });
  });

  // Public Bot Framework webhook. Authenticated via JWT (Microsoft App ID).
  app.post("/channels/teams/messages", async (request, response) => {
    try {
      const outcome = await acceptTeamsActivity(request);
      response.status(outcome.status).json(outcome.body);
      if (!outcome.activity) return;
      processTeamsActivity(outcome.activity).catch((error) => {
        console.error("[TeamsBot] activity processing failed:", error.message);
      });
    } catch (e) {
      console.error(e);
      if (!response.headersSent) response.status(500).json({ ok: false });
    }
  });
}

module.exports = { teamsChannelEndpoints };
