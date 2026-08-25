export const STEP_WORKSPACE = "workspace";
export const STEP_INVITE = "invite";
export const STEP_TOOLS = "tools";

export const DEFAULT_WORKSPACE_NAME = "My Workspace";

export const GETTING_STARTED_STEPS = [STEP_WORKSPACE, STEP_INVITE, STEP_TOOLS];

export function isWorkspaceNamed(
  workspace,
  defaultName = DEFAULT_WORKSPACE_NAME
) {
  const name = workspace?.name?.trim();
  if (!name) return false;
  return name !== defaultName;
}

export function isWorkspaceStepDone({
  workspace,
  saved = false,
  defaultName = DEFAULT_WORKSPACE_NAME,
}) {
  if (!workspace?.id && !workspace?.slug) return false;
  return saved || isWorkspaceNamed(workspace, defaultName);
}

export function isInviteStepDone({ invites = [], users = [] } = {}) {
  const hasInvite = invites.some(
    (invite) => invite?.status === "pending" || invite?.status === "claimed"
  );
  return hasInvite || users.length > 1;
}

export function isToolsStepDone({ skipped = false, connected = false } = {}) {
  return Boolean(skipped || connected);
}

export function firstIncompleteStep(progress) {
  if (!progress[STEP_WORKSPACE]) return STEP_WORKSPACE;
  if (!progress[STEP_INVITE]) return STEP_INVITE;
  if (!progress[STEP_TOOLS]) return STEP_TOOLS;
  return null;
}

export function completedCount(progress) {
  return GETTING_STARTED_STEPS.filter((id) => progress[id]).length;
}
