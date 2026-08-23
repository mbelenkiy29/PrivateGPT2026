const { registerAdapter } = require("../adapter");
const { DocumentSyncQueue } = require("../../../models/documentSyncQueue");
const { ConnectedFileSource } = require("../../../models/connectedFileSource");
const { TeamsFilesSource } = require("../../fileSources/teamsFiles");
const { resolveConnectedRecord } = require("../resolveRecord");
const { MAX_ITEMS_PER_RUN, WATCH_STALE_AFTER_MS } = require("../constants");
const { isExpiredDeltaError } = require("../expiredDelta");

const PROVIDER = ConnectedFileSource.providers.teamsFiles;

async function connected(opts = {}) {
  return resolveConnectedRecord(PROVIDER, opts);
}

function folderIdFrom(opts = {}) {
  return opts.folderId || opts.source?.remote_id || "root";
}

const adapter = {
  async list({ cursor, folderId, ...opts } = {}) {
    const record = await connected(opts);
    const parent = folderId || folderIdFrom(opts);
    const data = await TeamsFilesSource.listChildren(record, parent);
    return { items: data.items || [], cursor: data.next || cursor || null };
  },

  async download(item, opts = {}) {
    const record = await connected(opts);
    const fileId = typeof item === "string" ? item : item?.id;
    if (!fileId) throw new Error("Teams files download requires a file id.");
    return TeamsFilesSource.download(record, fileId);
  },

  async delta(cursor, opts = {}) {
    const record = await connected(opts);
    const folderId = folderIdFrom(opts);

    try {
      if (!cursor) {
        const link = await TeamsFilesSource.getDeltaLink(record, {
          id: folderId,
          driveId: opts.config?.driveId,
          itemId: opts.config?.itemId,
          teamId: opts.config?.teamId,
          channelId: opts.config?.channelId,
        });
        return { items: [], cursor: link };
      }

      const items = [];
      let token = cursor;

      while (true) {
        const page = await TeamsFilesSource.delta(record, folderId, token);
        const pageItems = (page.items || []).filter((item) => {
          if (item.deleted) return true;
          if (item.type === "folder") return false;
          return item.indexable !== false;
        });

        if (
          items.length > 0 &&
          items.length + pageItems.length > MAX_ITEMS_PER_RUN
        ) {
          return { items, cursor: token };
        }

        items.push(...pageItems);

        if (page.nextLink) {
          if (items.length >= MAX_ITEMS_PER_RUN) {
            return { items, cursor: page.nextLink };
          }
          token = page.nextLink;
          continue;
        }

        return { items, cursor: page.deltaLink || token || cursor || null };
      }
    } catch (e) {
      if (cursor && isExpiredDeltaError(e)) {
        const link = await TeamsFilesSource.getDeltaLink(record, {
          id: folderId,
          driveId: opts.config?.driveId,
          itemId: opts.config?.itemId,
          teamId: opts.config?.teamId,
          channelId: opts.config?.channelId,
        });
        return { items: [], cursor: link };
      }
      throw e;
    }
  },

  watchHint() {
    return { staleAfterMs: WATCH_STALE_AFTER_MS };
  },

  toChunkSource(item) {
    const id = typeof item === "string" ? item : item?.id;
    return `teams-files://${id || ""}`;
  },
};

registerAdapter(PROVIDER, adapter);
if (typeof DocumentSyncQueue.registerFileType === "function") {
  DocumentSyncQueue.registerFileType("teams-files");
}

module.exports = adapter;
