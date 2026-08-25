const ALLOWED_KEYS = [
  "action",
  "category",
  "source",
  "surface",
  "workspaceSlug",
  "incognito",
  "urlCount",
];

function sanitizeAudit(metadata = {}) {
  const clean = {};
  for (const key of ALLOWED_KEYS) {
    if (metadata[key] === undefined) continue;
    clean[key] = metadata[key];
  }
  return clean;
}

async function logBlock(metadata = {}, userId = null, logEvent) {
  if (typeof logEvent !== "function") return;
  await logEvent("content_guard_block", sanitizeAudit(metadata), userId);
}

async function logClassifierError(metadata = {}, userId = null, logEvent) {
  if (typeof logEvent !== "function") return;
  await logEvent(
    "content_guard_classifier_error",
    sanitizeAudit(metadata),
    userId
  );
}

module.exports = {
  sanitizeAudit,
  logBlock,
  logClassifierError,
};
