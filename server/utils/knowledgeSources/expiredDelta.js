/**
 * Drive 410 / Graph resyncRequired mean the saved cursor is unusable.
 * Callers should mint a fresh startPageToken or deltaLink instead of
 * falling back to a children-list page token.
 */
function isExpiredDeltaError(err) {
  const status = Number(err?.status || err?.statusCode || 0);
  if (status === 410) return true;
  const msg = String(err?.message || "").toLowerCase();
  return (
    msg.includes("410") ||
    msg.includes("resyncrequired") ||
    msg.includes("page token") ||
    msg.includes("delta link") ||
    (msg.includes("expired") &&
      (msg.includes("token") || msg.includes("delta")))
  );
}

module.exports = { isExpiredDeltaError };
