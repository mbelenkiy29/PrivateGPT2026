const { log, conclude } = require("./helpers/index.js");
const { SystemSettings } = require("../models/systemSettings.js");
const { WorkspaceChats } = require("../models/workspaceChats.js");
const { EmbedChats } = require("../models/embedChats.js");

/**
 * Delete workspace_chats and embed_chats older than chat_retention_days.
 * 0 = keep forever (no deletes). Default retention is 90 days.
 * @returns {Promise<{ skipped: boolean, days: number, cutoff: Date|null }>}
 */
async function cleanupExpiredChats() {
  const days = await SystemSettings.chatRetentionDays();
  if (days === 0) {
    log("Chat retention is 0 — keeping all chats.");
    return { skipped: true, days, cutoff: null };
  }

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  await WorkspaceChats.delete({ createdAt: { lt: cutoff } });
  await EmbedChats.delete({ createdAt: { lt: cutoff } });
  log(
    `Deleted workspace and embed chats older than ${days} days (before ${cutoff.toISOString()}).`
  );
  return { skipped: false, days, cutoff };
}

module.exports = { cleanupExpiredChats };

if (!process.env.JEST_WORKER_ID) {
  (async () => {
    try {
      await cleanupExpiredChats();
    } catch (e) {
      console.error(e);
      log(`errored with ${e.message}`);
    } finally {
      conclude();
    }
  })();
}
