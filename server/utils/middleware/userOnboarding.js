const { SystemSettings } = require("../../models/systemSettings");
const { userFromSession } = require("../http");

function requestPath(request) {
  return (
    String(request.path || request.url || "")
      .split("?")[0]
      .replace(/\/+$/, "") || "/"
  );
}

function isAllowedWhileOnboarding(method, path) {
  const verb = String(method || "GET").toUpperCase();

  if (
    path === "/ping" ||
    path === "/debug/sentry-test" ||
    path === "/setup-complete" ||
    path === "/onboarding" ||
    path === "/system/multi-user-mode"
  ) {
    return true;
  }
  if (path.startsWith("/request-token")) return true;
  if (path.startsWith("/invite/")) return true;
  if (path === "/system/refresh-user") return true;
  if (
    path === "/system/support-email" ||
    path === "/system/footer-data" ||
    path === "/system/custom-app-name"
  ) {
    return true;
  }
  if (path === "/system/user") return true;
  if (path === "/system/upload-pfp" || path === "/system/remove-pfp")
    return true;
  if (path.startsWith("/system/pfp/")) return true;
  if (
    path === "/system/upload-logo" ||
    path === "/system/remove-logo" ||
    path === "/system/logo" ||
    path === "/system/is-default-logo"
  ) {
    return true;
  }
  if (path === "/user/onboarding" || path === "/user/onboarding/complete")
    return true;
  if (path === "/workspaces" && verb === "GET") return true;
  if (path === "/workspace/new" && verb === "POST") return true;
  if (/^\/workspace\/[^/]+$/.test(path) && verb === "GET") return true;
  if (/^\/workspace\/[^/]+\/update$/.test(path) && verb === "POST") return true;
  if (path === "/admin/invites" && verb === "GET") return true;
  if (path === "/admin/invite/new" && verb === "POST") return true;
  if (
    path === "/slack/status" ||
    path === "/channels/teams/config" ||
    path === "/telegram/status" ||
    path === "/file-sources"
  ) {
    return true;
  }
  return false;
}

/**
 * Blocks multi-user accounts that have not finished person-level onboarding
 * from using the rest of the API. Public/auth/onboarding routes stay open.
 */
async function requireOnboardingComplete(request, response, next) {
  try {
    const multiUserMode =
      response.locals?.multiUserMode ??
      (await SystemSettings.isMultiUserMode());
    if (!multiUserMode) return next();

    const user =
      response.locals?.user ?? (await userFromSession(request, response));
    if (!user) return next();
    if (user.onboardingComplete === true || user.onboardingComplete === 1)
      return next();

    const path = requestPath(request);
    if (isAllowedWhileOnboarding(request.method, path)) return next();

    response.status(403).json({
      success: false,
      onboardingRequired: true,
      error: "Finish onboarding to continue.",
    });
  } catch (error) {
    console.error("requireOnboardingComplete", error.message);
    next();
  }
}

module.exports = {
  requireOnboardingComplete,
  isAllowedWhileOnboarding,
  requestPath,
};
