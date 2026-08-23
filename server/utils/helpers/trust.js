/**
 * Only a JSON number is accepted. Number(null)===0 and Number("")===0 would
 * otherwise silently set keep-forever (0).
 * @param {*} days
 * @returns {{ days: number|null, error: string|null }}
 */
function parseRetentionDays(days) {
  if (typeof days !== "number" || !Number.isFinite(days) || days < 0) {
    return {
      days: null,
      error: "days must be a number >= 0 (0 = keep forever).",
    };
  }
  return { days: Math.floor(days), error: null };
}

/**
 * Embed widget transcripts are session-scoped; `embed_chats.usersId` is never
 * written. The association that exists is the embed config creator.
 * Keep `usersId` in the OR so a future write is still picked up.
 */
function embedChatClauseForUser(userId) {
  const id = Number(userId);
  return {
    OR: [{ usersId: id }, { embed_config: { createdBy: id } }],
  };
}

module.exports = { parseRetentionDays, embedChatClauseForUser };
