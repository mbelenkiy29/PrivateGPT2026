const DELTA_CAP = 200;
const WATCH_HINT = { poll: true, staleAfterMs: 60 * 60 * 1000 };

const SKIP_MAILBOX_RE =
  /(^|\/)(spam|junk|trash|deleted items|deleted|bin|junk e-?mail|recoverable items)(\/|$)/i;

/**
 * @param {string} name
 * @param {string[]} [attrs]
 * @returns {boolean}
 */
function isSkippedMailbox(name, attrs = []) {
  const n = String(name || "");
  if (SKIP_MAILBOX_RE.test(n)) return true;
  return (attrs || []).some((attr) => {
    const a = String(attr).replace(/^\\/, "").toLowerCase();
    return a === "trash" || a === "junk" || a === "spam" || a === "bin";
  });
}

function htmlToText(html) {
  if (!html) return "";
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|tr|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function looksLikeHtml(value) {
  return /<\/?[a-z][\s\S]*>/i.test(String(value || ""));
}

function bodyAsText(body, bodyType) {
  const raw = body == null ? "" : String(body);
  if (bodyType === "html" || looksLikeHtml(raw)) return htmlToText(raw);
  return raw.trim();
}

function formatAddress(value) {
  if (!value) return "";
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  return String(value);
}

function toMailMarkdown({
  from,
  to,
  subject,
  date,
  body,
  attachments,
  attachmentNote,
} = {}) {
  const names = (attachments || []).filter(Boolean);
  const lines = [
    `# ${subject || "(no subject)"}`,
    "",
    `- From: ${formatAddress(from)}`,
    `- To: ${formatAddress(to)}`,
    `- Date: ${date || ""}`,
    "",
    bodyAsText(body),
  ];
  if (names.length > 0 || attachmentNote) {
    lines.push(
      "",
      attachmentNote || `_Attachments skipped: ${names.join(", ")}_`
    );
  }
  return lines.join("\n").trim() + "\n";
}

function safeFilename(name) {
  return String(name || "email")
    .replace(/[\\/]/g, "_")
    .replace(/[^\w.\- ()]/g, "_")
    .slice(0, 80);
}

/**
 * Knowledge-source download payload: markdown plus the original mail fields.
 * Attachments are noted, not downloaded (collector path is file-oriented).
 */
function mailDownloadPayload(item = {}) {
  const fields = {
    from: formatAddress(item.from),
    to: formatAddress(item.to),
    subject: item.subject || "(no subject)",
    date: item.date || item.receivedDateTime || "",
    body: bodyAsText(item.body, item.bodyType),
  };
  const attachments = (item.attachments || [])
    .map((att) => (typeof att === "string" ? att : att?.name))
    .filter(Boolean);
  if (item.hasAttachments && attachments.length === 0) {
    attachments.push("(unnamed attachment)");
  }
  const markdown = toMailMarkdown({ ...fields, attachments });
  return {
    ...fields,
    markdown,
    pageContent: markdown,
    name: `${safeFilename(fields.subject)}.md`,
    mime: "text/markdown",
    remoteId: String(item.id || item.uid || ""),
    modifiedAt: fields.date,
    buffer: Buffer.from(markdown, "utf8"),
    attachmentsSkipped: attachments,
  };
}

function capItems(items, limit = DELTA_CAP) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, Math.max(0, Number(limit) || DELTA_CAP));
}

function parseJsonCursor(cursor, fallbackKey) {
  if (cursor == null || cursor === "") return {};
  if (typeof cursor === "object" && !Array.isArray(cursor)) {
    if (cursor.cursor != null && cursor.config == null && fallbackKey)
      return parseJsonCursor(cursor.cursor, fallbackKey);
    return cursor;
  }
  const raw = String(cursor);
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {}
  return fallbackKey ? { [fallbackKey]: raw } : { value: raw };
}

function stringifyCursor(obj) {
  if (obj == null) return null;
  if (typeof obj === "string") return obj;
  return JSON.stringify(obj);
}

function resolveConfig(opts = {}, fallback = {}) {
  if (opts.config && typeof opts.config === "object") return opts.config;
  return fallback || {};
}

function registerWatchType(type) {
  try {
    const { DocumentSyncQueue } = require("../../models/documentSyncQueue");
    DocumentSyncQueue.registerFileType(type);
  } catch {}
}

module.exports = {
  DELTA_CAP,
  WATCH_HINT,
  isSkippedMailbox,
  htmlToText,
  bodyAsText,
  toMailMarkdown,
  mailDownloadPayload,
  capItems,
  parseJsonCursor,
  stringifyCursor,
  resolveConfig,
  registerWatchType,
};
