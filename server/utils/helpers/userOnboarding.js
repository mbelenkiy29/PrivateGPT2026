const { ROLES } = require("../middleware/multiUserProtected");

function trimName(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function hasProfileNames(user = {}) {
  return Boolean(trimName(user.firstName) && trimName(user.lastName));
}

function displayName(user = {}) {
  const name = [trimName(user.firstName), trimName(user.lastName)]
    .filter(Boolean)
    .join(" ");
  return name || user.username || "";
}

function isAdminSetupRole(role) {
  return role === ROLES.admin || role === ROLES.manager;
}

function hasNamedWorkspace(workspaces = []) {
  return Array.isArray(workspaces) && workspaces.length > 0;
}

function hasInvite(invites = []) {
  return (
    Array.isArray(invites) &&
    invites.some(
      (invite) => invite?.status === "pending" || invite?.status === "claimed"
    )
  );
}

function onboardingRequirements({
  user = {},
  workspaces = [],
  invites = [],
} = {}) {
  const profile = hasProfileNames(user);
  const workspace = hasNamedWorkspace(workspaces);
  const invite = hasInvite(invites);
  const admin = isAdminSetupRole(user.role);
  return {
    firstName: Boolean(trimName(user.firstName)),
    lastName: Boolean(trimName(user.lastName)),
    workspace: admin ? workspace : true,
    invite: admin ? invite : true,
    canComplete: admin ? profile && workspace && invite : profile,
  };
}

module.exports = {
  trimName,
  hasProfileNames,
  displayName,
  isAdminSetupRole,
  hasNamedWorkspace,
  hasInvite,
  onboardingRequirements,
};
