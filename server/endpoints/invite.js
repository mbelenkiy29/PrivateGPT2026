const { EventLogs } = require("../models/eventLogs");
const { Invite } = require("../models/invite");
const { Organization } = require("../models/organization");
const { User } = require("../models/user");
const { reqBody, sessionTokenForUser } = require("../utils/http");
const { sessionUserPayload } = require("../utils/tenant");
const {
  simpleSSOLoginDisabledMiddleware,
} = require("../utils/middleware/simpleSSOEnabled");

function inviteEndpoints(app) {
  if (!app) return;

  app.get("/invite/:code", async (request, response) => {
    try {
      const { code } = request.params;
      const invite = await Invite.get({ code });
      if (!invite) {
        response.status(200).json({ invite: null, error: "Invite not found." });
        return;
      }

      if (invite.status !== "pending") {
        response
          .status(200)
          .json({ invite: null, error: "Invite is no longer valid." });
        return;
      }

      response
        .status(200)
        .json({ invite: { code, status: invite.status }, error: null });
    } catch (e) {
      console.error(e);
      response.sendStatus(500).end();
    }
  });

  app.post(
    "/invite/:code",
    [simpleSSOLoginDisabledMiddleware],
    async (request, response) => {
      try {
        const { code } = request.params;
        const { username, password, firstName, lastName, email } =
          reqBody(request);
        const invite = await Invite.get({ code });
        if (!invite || invite.status !== "pending") {
          response
            .status(200)
            .json({ success: false, error: "Invite not found or is invalid." });
          return;
        }

        if (!String(firstName || "").trim() || !String(lastName || "").trim()) {
          response.status(200).json({
            success: false,
            error: "First name and last name are required.",
          });
          return;
        }

        const resolvedUsername =
          username ||
          (email ? await User.uniqueUsernameFromEmail(email) : null);
        const { user, error } = await User.create({
          username: resolvedUsername,
          password,
          firstName,
          lastName,
          email: email || null,
          role: "default",
        });
        if (!user) {
          console.error("Accepting invite:", error);
          response.status(200).json({ success: false, error });
          return;
        }

        await Invite.markClaimed(invite.id, user);
        await EventLogs.logEvent(
          "invite_accepted",
          {
            username: user.username,
          },
          user.id
        );

        const { organization, membership } = await Organization.resolveForUser(
          user.id,
          invite.organizationId,
          { requirePreferred: Boolean(invite.organizationId) }
        );
        const token = organization
          ? sessionTokenForUser(user, organization)
          : null;

        response.status(200).json({
          success: true,
          error: null,
          valid: Boolean(token),
          token,
          user: sessionUserPayload(user, membership, organization),
        });
      } catch (e) {
        console.error(e);
        response.sendStatus(500).end();
      }
    }
  );
}

module.exports = { inviteEndpoints };
