const { reqBody, userFromSession } = require("../utils/http");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { User } = require("../models/user");
const { Workspace } = require("../models/workspace");
const { Invite } = require("../models/invite");
const {
  onboardingRequirements,
  isAdminSetupRole,
} = require("../utils/helpers/userOnboarding");

async function loadOnboardingContext(user) {
  const workspaces = isAdminSetupRole(user.role)
    ? await Workspace.where()
    : await Workspace.whereWithUser(user);
  const invites = isAdminSetupRole(user.role)
    ? await Invite.where({ createdBy: user.id })
    : [];
  const requirements = onboardingRequirements({ user, workspaces, invites });
  return { workspaces, invites, requirements };
}

function userOnboardingEndpoints(app) {
  if (!app) return;

  app.get(
    "/user/onboarding",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const user = await userFromSession(request, response);
        if (!user) {
          response.status(401).json({ error: "Invalid session." });
          return;
        }
        const { workspaces, requirements } = await loadOnboardingContext(user);
        response.status(200).json({
          complete: Boolean(user.onboardingComplete),
          role: user.role,
          firstName: user.firstName || "",
          lastName: user.lastName || "",
          hasPfp: Boolean(user.pfpFilename),
          requirements,
          workspaces: (workspaces || []).map((workspace) => ({
            id: workspace.id,
            name: workspace.name,
            slug: workspace.slug,
          })),
        });
      } catch (error) {
        console.error(error);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/user/onboarding/complete",
    [validatedRequest, flexUserRoleValid([ROLES.all])],
    async (request, response) => {
      try {
        const sessionUser = await userFromSession(request, response);
        if (!sessionUser) {
          response
            .status(401)
            .json({ success: false, error: "Invalid session." });
          return;
        }

        const body = reqBody(request) || {};
        const updates = {};
        if (body.firstName !== undefined) updates.firstName = body.firstName;
        if (body.lastName !== undefined) updates.lastName = body.lastName;
        if (Object.keys(updates).length) {
          const { success, error } = await User.update(sessionUser.id, updates);
          if (!success) {
            response.status(200).json({ success: false, error });
            return;
          }
        }

        const user = await User.get({ id: sessionUser.id });
        const { requirements } = await loadOnboardingContext(user);
        if (!requirements.canComplete) {
          response.status(200).json({
            success: false,
            error: "Finish required onboarding steps first.",
            requirements,
          });
          return;
        }

        const { user: completed, error } = await User.markOnboardingComplete(
          user.id
        );
        if (!completed) {
          response.status(200).json({ success: false, error });
          return;
        }

        response.status(200).json({
          success: true,
          error: null,
          user: completed,
        });
      } catch (error) {
        console.error(error);
        response.status(500).json({ success: false, error: error.message });
      }
    }
  );
}

module.exports = { userOnboardingEndpoints };
