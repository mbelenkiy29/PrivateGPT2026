const SITES_CONSENT_MESSAGE =
  "SharePoint libraries need the Sites.Read.All Graph permission. Reconnect Microsoft and accept the SharePoint consent prompt. A Teams bot is not required to index files.";

const TEAMS_CONSENT_MESSAGE =
  "Teams channel files need Team.ReadBasic.All and Channel.ReadBasic.All Graph permissions. Reconnect Microsoft and accept the Graph consent prompt. A Teams bot (chat) is a separate consent and is not required to index files.";

function tokenHasScope(accessToken, scope) {
  try {
    const part = String(accessToken || "").split(".")[1];
    if (!part) return true;
    const padded = part.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    const scp = String(payload.scp || payload.scope || "");
    const roles = Array.isArray(payload.roles) ? payload.roles : [];
    return scp.split(/\s+/).includes(scope) || roles.includes(scope);
  } catch {
    return true;
  }
}

function isConsentError(err) {
  const status = Number(err?.status || err?.statusCode || 0);
  if (status === 401 || status === 403) return true;
  const msg = String(err?.message || "").toLowerCase();
  return (
    msg.includes("access denied") ||
    msg.includes("access is denied") ||
    msg.includes("insufficient privileges") ||
    msg.includes("authorization_requestdenied") ||
    msg.includes("sites.read.all") ||
    msg.includes("team.readbasic.all") ||
    msg.includes("channel.readbasic.all") ||
    msg.includes("either scp or roles")
  );
}

function consentError(message, cause) {
  const err = new Error(message);
  err.status = cause?.status || 403;
  if (cause) err.cause = cause;
  return err;
}

function throwIfMissingScope(accessToken, scope, message) {
  if (tokenHasScope(accessToken, scope)) return;
  throw consentError(message);
}

function rethrowConsent(err, message) {
  if (isConsentError(err)) throw consentError(message, err);
  throw err;
}

module.exports = {
  SITES_CONSENT_MESSAGE,
  TEAMS_CONSENT_MESSAGE,
  tokenHasScope,
  isConsentError,
  consentError,
  throwIfMissingScope,
  rethrowConsent,
};
