const { reqBody } = require("../../utils/http");
const { validatedRequest } = require("../../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../../utils/middleware/multiUserProtected");
const {
  acceptSlackEvent,
  processSlackCallback,
  publicBotConfig,
  saveBotConfig,
  disableBot,
} = require("../../utils/channelChat/slack");

function slackChannelEndpoints(app) {
  if (!app) return;

  app.get(
    "/channels/slack/config",
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
    "/channels/slack/config",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const body = reqBody(request) || {};
        const result = await saveBotConfig({
          signingSecret: body.signingSecret || body.signing_secret,
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
    "/channels/slack/disconnect",
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

  // Public Events API endpoint. Authenticated via Slack signing secret.
  app.post("/channels/slack/events", async (request, response) => {
    try {
      const outcome = await acceptSlackEvent(request);
      response.status(outcome.status).json(outcome.body);
      if (!outcome.event) return;
      processSlackCallback(outcome.event).catch((error) => {
        console.error("[SlackBot] event processing failed:", error.message);
      });
    } catch (e) {
      console.error(e);
      if (!response.headersSent) response.status(500).json({ ok: false });
    }
  });
}

module.exports = { slackChannelEndpoints };
