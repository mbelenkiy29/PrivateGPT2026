const gmailLib = require("../agents/aibitat/plugins/gmail/lib");
const outlookLib = require("../agents/aibitat/plugins/outlook/lib");

const NOT_CONNECTED = "not connected";
const GMAIL_COMPOSE_URL = "https://mail.google.com/mail/u/0/#drafts?compose=";
const OUTLOOK_DRAFTS_URL = "https://outlook.office.com/mail/drafts";
const DEFAULT_LIMIT = 50;

/**
 * Map provider/auth failures to a stable UI error. The inbox always
 * returns HTTP 200 so the frontend can render an empty/connect state.
 * @param {string|undefined} error
 * @returns {string}
 */
function normalizeListError(error) {
  if (!error) return NOT_CONNECTED;
  const message = String(error).toLowerCase();
  if (
    message.includes("not configured") ||
    message.includes("not authenticated") ||
    message.includes("not available") ||
    message.includes("multi-user") ||
    message.includes("not connected")
  ) {
    return NOT_CONNECTED;
  }
  return String(error);
}

/**
 * @param {object} draft
 * @returns {string}
 */
function snippetFrom(draft = {}) {
  const raw = draft.snippet || draft.preview || draft.body || "";
  const text = String(raw).replace(/\s+/g, " ").trim();
  if (text.length <= 200) return text;
  return `${text.slice(0, 200)}…`;
}

/**
 * @param {string|number|Date|null|undefined} value
 * @returns {string|null}
 */
function toCreatedAt(value) {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/**
 * @param {object} draft
 * @returns {{id: string, provider: string, to: string, subject: string, snippet: string, createdAt: string|null, openUrl: string}}
 */
function mapGmailDraft(draft = {}) {
  const id = String(draft.draftId || draft.id || "");
  const composeId = draft.messageId || id;
  return {
    id,
    provider: "gmail",
    to: draft.to || "",
    subject: draft.subject || "",
    snippet: snippetFrom(draft),
    createdAt: toCreatedAt(draft.date || draft.createdAt),
    openUrl: draft.webLink || `${GMAIL_COMPOSE_URL}${composeId}`,
  };
}

/**
 * @param {object} draft
 * @returns {{id: string, provider: string, to: string, subject: string, snippet: string, createdAt: string|null, openUrl: string}}
 */
function mapOutlookDraft(draft = {}) {
  const id = String(draft.id || draft.draftId || "");
  return {
    id,
    provider: "outlook",
    to: draft.to || "",
    subject: draft.subject || "",
    snippet: snippetFrom(draft),
    createdAt: toCreatedAt(
      draft.lastModified || draft.createdAt || draft.receivedDateTime
    ),
    openUrl: draft.webLink || OUTLOOK_DRAFTS_URL,
  };
}

function draftsFromResult(result) {
  if (Array.isArray(result?.data?.drafts)) return result.data.drafts;
  if (Array.isArray(result?.data)) return result.data;
  return [];
}

/**
 * List Gmail drafts using the existing agent-skill auth/config.
 * @param {number} [limit]
 * @returns {Promise<{drafts: object[], error: string|null}>}
 */
async function listGmailDrafts(limit = DEFAULT_LIMIT) {
  try {
    const result = await gmailLib.listDrafts(limit);
    if (!result?.success) {
      return { drafts: [], error: normalizeListError(result?.error) };
    }
    return {
      drafts: draftsFromResult(result).map(mapGmailDraft),
      error: null,
    };
  } catch (error) {
    return { drafts: [], error: normalizeListError(error.message) };
  }
}

/**
 * List Outlook drafts using the existing agent-skill OAuth config.
 * @param {number} [limit]
 * @returns {Promise<{drafts: object[], error: string|null}>}
 */
async function listOutlookDrafts(limit = DEFAULT_LIMIT) {
  try {
    const result = await outlookLib.listDrafts(limit);
    if (!result?.success) {
      return { drafts: [], error: normalizeListError(result?.error) };
    }
    return {
      drafts: draftsFromResult(result).map(mapOutlookDraft),
      error: null,
    };
  } catch (error) {
    return { drafts: [], error: normalizeListError(error.message) };
  }
}

/**
 * Fetch Gmail and Outlook drafts in parallel for the review inbox.
 * @returns {Promise<{gmail: {drafts: object[], error: string|null}, outlook: {drafts: object[], error: string|null}}>}
 */
async function listPendingDrafts() {
  const [gmail, outlook] = await Promise.all([
    listGmailDrafts(),
    listOutlookDrafts(),
  ]);
  return { gmail, outlook };
}

module.exports = {
  NOT_CONNECTED,
  GMAIL_COMPOSE_URL,
  OUTLOOK_DRAFTS_URL,
  listGmailDrafts,
  listOutlookDrafts,
  listPendingDrafts,
  mapGmailDraft,
  mapOutlookDraft,
};
