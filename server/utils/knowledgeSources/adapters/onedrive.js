const { registerAdapter } = require("../adapter");
const { DocumentSyncQueue } = require("../../../models/documentSyncQueue");
const { ConnectedFileSource } = require("../../../models/connectedFileSource");
const { OneDriveSource } = require("../../fileSources/onedrive");
const { resolveConnectedRecord } = require("../resolveRecord");
const { MAX_ITEMS_PER_RUN, WATCH_STALE_AFTER_MS } = require("../constants");
const { isExpiredDeltaError } = require("../expiredDelta");

const PROVIDER = ConnectedFileSource.providers.onedrive;

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
    const data = await OneDriveSource.listChildren(record, parent);
    return { items: data.items || [], cursor: data.next || cursor || null };
  },

  async download(item, opts = {}) {
    const record = await connected(opts);
    const fileId = typeof item === "string" ? item : item?.id;
    if (!fileId) throw new Error("OneDrive download requires a file id.");
    return OneDriveSource.download(record, fileId);
  },

  async delta(cursor, opts = {}) {
    const record = await connected(opts);
    const folderId = folderIdFrom(opts);

    try {
      if (!cursor) {
        const link = await OneDriveSource.getDeltaLink(record, folderId);
        return { items: [], cursor: link };
      }

      const items = [];
      let token = cursor;

      while (true) {
        const page = await OneDriveSource.delta(record, folderId, token);
        const pageItems = (page.items || []).filter((item) => {
          if (item.deleted) return true;
          if (item.type === "folder") return false;
          return item.indexable !== false;
        });

        if (
          items.length > 0 &&
          items.length + pageItems.length > MAX_ITEMS_PER_RUN
        ) {
          // Resume on this unconsumed page; do not persist next/delta links.
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
        const link = await OneDriveSource.getDeltaLink(record, folderId);
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
    return `onedrive://${id || ""}`;
  },
};

registerAdapter(PROVIDER, adapter);
if (typeof DocumentSyncQueue.registerFileType === "function") {
  DocumentSyncQueue.registerFileType("onedrive");
}

module.exports = adapter;
