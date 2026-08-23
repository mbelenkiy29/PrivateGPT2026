const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const { listPendingDrafts } = require("../utils/mailDrafts");

function mailDraftEndpoints(app) {
  if (!app) return;

  app.get(
    "/mail-drafts",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (_request, response) => {
      try {
        const { gmail, outlook } = await listPendingDrafts();
        return response.status(200).json({
          gmail: gmail.drafts,
          outlook: outlook.drafts,
          errors: {
            gmail: gmail.error,
            outlook: outlook.error,
          },
        });
      } catch (e) {
        console.error(e.message, e);
        return response.status(200).json({
          gmail: [],
          outlook: [],
          errors: {
            gmail: "not connected",
            outlook: "not connected",
          },
        });
      }
    }
  );
}

module.exports = { mailDraftEndpoints };
