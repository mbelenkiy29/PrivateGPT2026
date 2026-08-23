const { registerAdapter } = require("../adapter");
const { DocumentSyncQueue } = require("../../../models/documentSyncQueue");
const { ConnectedFileSource } = require("../../../models/connectedFileSource");
const { GoogleDriveSource } = require("../../fileSources/googleDrive");
const { resolveConnectedRecord } = require("../resolveRecord");
const { MAX_ITEMS_PER_RUN, WATCH_STALE_AFTER_MS } = require("../constants");

const PROVIDER = ConnectedFileSource.providers.googleDrive;

async function connected(opts = {}) {
  return resolveConnectedRecord(PROVIDER, opts);
}

function folderIdFrom(opts = {}) {
  return opts.folderId || opts.source?.remote_id || null;
}

function watchedFolderIds(opts = {}) {
  const folderId = folderIdFrom(opts);
  if (Array.isArray(opts.config?.folderIds) && opts.config.folderIds.length)
    return new Set(opts.config.folderIds);
  if (folderId) return new Set([folderId]);
  return new Set();
}

function inWatchedFolder(item, folderIds, folderId) {
  if (!folderId || folderId === "root" || !folderIds.size) return true;
  return (item.parents || []).some((parent) => folderIds.has(parent));
}

const adapter = {
  async list({ cursor, folderId, ...opts } = {}) {
    const record = await connected(opts);
    const parent = folderId || folderIdFrom(opts) || "root";
    const data = await GoogleDriveSource.listChildren(record, parent);
    return { items: data.items || [], cursor: data.next || cursor || null };
  },

  async download(item, opts = {}) {
    const record = await connected(opts);
    const fileId = typeof item === "string" ? item : item?.id;
    if (!fileId) throw new Error("Google Drive download requires a file id.");
    return GoogleDriveSource.download(record, fileId);
  },

  async delta(cursor, opts = {}) {
    const record = await connected(opts);
    const folderId = folderIdFrom(opts);
    const folderIds = watchedFolderIds(opts);
    const addedFolders = [];

    if (!cursor) {
      const start = await GoogleDriveSource.getStartPageToken(record);
      return { items: [], cursor: start };
    }

    const items = [];
    let pageToken = cursor;
    let newStart = null;

    while (pageToken && items.length < MAX_ITEMS_PER_RUN) {
      const page = await GoogleDriveSource.listChanges(record, pageToken);
      newStart = page.newStartPageToken || newStart;
      const remaining = MAX_ITEMS_PER_RUN - items.length;

      for (const item of page.items || []) {
        if (items.length >= remaining) break;
        if (item.deleted) {
          items.push(item);
          continue;
        }
        if (item.type === "folder") {
          if (inWatchedFolder(item, folderIds, folderId)) {
            folderIds.add(item.id);
            addedFolders.push(item.id);
          }
          continue;
        }
        if (!inWatchedFolder(item, folderIds, folderId)) continue;
        items.push(item);
      }

      pageToken = page.nextPageToken || null;
      if (!page.nextPageToken) break;
    }

    return {
      items,
      cursor: pageToken || newStart || cursor,
      config: addedFolders.length
        ? { folderIds: Array.from(folderIds) }
        : undefined,
    };
  },

  watchHint() {
    return { staleAfterMs: WATCH_STALE_AFTER_MS };
  },

  toChunkSource(item) {
    const id = typeof item === "string" ? item : item?.id;
    return `gdrive://${id || ""}`;
  },
};

registerAdapter(PROVIDER, adapter);
DocumentSyncQueue.registerFileType("gdrive");

module.exports = adapter;
