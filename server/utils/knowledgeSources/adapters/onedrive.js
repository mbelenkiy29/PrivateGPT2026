const { registerAdapter } = require("../adapter");
const { DocumentSyncQueue } = require("../../../models/documentSyncQueue");
const { ConnectedFileSource } = require("../../../models/connectedFileSource");
const { OneDriveSource } = require("../../fileSources/onedrive");
const { resolveConnectedRecord } = require("../resolveRecord");
const { MAX_ITEMS_PER_RUN, WATCH_STALE_AFTER_MS } = require("../constants");

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
    const items = [];
    let token = cursor || null;
    let deltaLink = null;

    while (items.length < MAX_ITEMS_PER_RUN) {
      const page = await OneDriveSource.delta(record, folderId, token);
      deltaLink = page.deltaLink || deltaLink;
      const remaining = MAX_ITEMS_PER_RUN - items.length;
      items.push(...(page.items || []).slice(0, remaining));

      if (page.nextLink && items.length < MAX_ITEMS_PER_RUN) {
        token = page.nextLink;
        continue;
      }
      if (page.nextLink && items.length >= MAX_ITEMS_PER_RUN) {
        return { items, cursor: page.nextLink };
      }
      break;
    }

    return { items, cursor: deltaLink || token || cursor || null };
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
DocumentSyncQueue.registerFileType("onedrive");

module.exports = adapter;
