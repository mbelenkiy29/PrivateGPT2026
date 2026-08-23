const { registerAdapter } = require("../adapter");
const { DocumentSyncQueue } = require("../../../models/documentSyncQueue");
const { ConnectedFileSource } = require("../../../models/connectedFileSource");
const { GoogleDriveSource } = require("../../fileSources/googleDrive");
const { resolveConnectedRecord } = require("../resolveRecord");
const { MAX_ITEMS_PER_RUN, WATCH_STALE_AFTER_MS } = require("../constants");
const { isExpiredDeltaError } = require("../expiredDelta");

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

function knownRemoteIdSet(opts = {}) {
  if (opts.knownRemoteIds instanceof Set) return opts.knownRemoteIds;
  if (Array.isArray(opts.knownRemoteIds)) return new Set(opts.knownRemoteIds);
  return new Set();
}

function configPatch(addedFolders, folderIds) {
  if (!addedFolders.length) return undefined;
  return { folderIds: Array.from(folderIds) };
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
    const knownRemoteIds = knownRemoteIdSet(opts);
    const addedFolders = [];

    try {
      if (!cursor) {
        const start = await GoogleDriveSource.getStartPageToken(record);
        return { items: [], cursor: start };
      }

      const items = [];
      let pageToken = cursor;

      while (pageToken) {
        const page = await GoogleDriveSource.listChanges(record, pageToken);
        const relevant = [];
        for (const item of page.items || []) {
          if (item.deleted) {
            if (knownRemoteIds.has(item.id)) relevant.push(item);
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
          if (item.indexable === false) continue;
          relevant.push(item);
        }

        // Do not consume this page (or advance past it) if it would overflow.
        if (
          items.length > 0 &&
          items.length + relevant.length > MAX_ITEMS_PER_RUN
        ) {
          return {
            items,
            cursor: pageToken,
            config: configPatch(addedFolders, folderIds),
          };
        }

        items.push(...relevant);

        if (page.nextPageToken) {
          pageToken = page.nextPageToken;
          if (items.length >= MAX_ITEMS_PER_RUN) {
            return {
              items,
              cursor: pageToken,
              config: configPatch(addedFolders, folderIds),
            };
          }
          continue;
        }

        return {
          items,
          cursor: page.newStartPageToken || pageToken,
          config: configPatch(addedFolders, folderIds),
        };
      }

      return {
        items,
        cursor: pageToken || cursor,
        config: configPatch(addedFolders, folderIds),
      };
    } catch (e) {
      if (cursor && isExpiredDeltaError(e)) {
        const start = await GoogleDriveSource.getStartPageToken(record);
        return { items: [], cursor: start };
      }
      throw e;
    }
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
if (typeof DocumentSyncQueue.registerFileType === "function") {
  DocumentSyncQueue.registerFileType("gdrive");
}

module.exports = adapter;
