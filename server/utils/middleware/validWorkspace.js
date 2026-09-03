const { Workspace } = require("../../models/workspace");
const { WorkspaceThread } = require("../../models/workspaceThread");
const { userFromSession, multiUserMode } = require("../http");

// Will pre-validate and set the workspace for a request if the slug is provided in the URL path.
async function validWorkspaceSlug(request, response, next) {
  const { slug } = request.params;
  const user = await userFromSession(request, response);
  const tenantId = response.locals?.tenantId || user?.organizationId || null;
  const clause = {
    slug,
    ...(tenantId ? { organizationId: Number(tenantId) } : {}),
  };
  const workspace = multiUserMode(response)
    ? await Workspace.getWithUser(user, clause)
    : await Workspace.get(clause);

  if (!workspace) {
    response.status(404).send("Workspace does not exist.");
    return;
  }

  response.locals.workspace = workspace;
  next();
}

// Will pre-validate and set the workspace AND a thread for a request if the slugs are provided in the URL path.
async function validWorkspaceAndThreadSlug(request, response, next) {
  const { slug, threadSlug } = request.params;
  const user = await userFromSession(request, response);
  const tenantId = response.locals?.tenantId || user?.organizationId || null;
  const clause = {
    slug,
    ...(tenantId ? { organizationId: Number(tenantId) } : {}),
  };
  const workspace = multiUserMode(response)
    ? await Workspace.getWithUser(user, clause)
    : await Workspace.get(clause);

  if (!workspace) {
    response.status(404).send("Workspace does not exist.");
    return;
  }

  const thread = await WorkspaceThread.get({
    slug: threadSlug,
    user_id: user?.id || null,
    workspace_id: workspace.id,
  });
  if (!thread) {
    response.status(404).send("Workspace thread does not exist.");
    return;
  }

  response.locals.workspace = workspace;
  response.locals.thread = thread;
  next();
}

module.exports = {
  validWorkspaceSlug,
  validWorkspaceAndThreadSlug,
};
