const { KnowledgeSource } = require("../../models/knowledgeSource");
const {
  KnowledgeSourceSyncRun,
} = require("../../models/knowledgeSourceSyncRun");
const { DocumentSyncQueue } = require("../../models/documentSyncQueue");
const { Workspace } = require("../../models/workspace");
const { Document } = require("../../models/documents");
const { CollectorApi } = require("../collectorApi");
const { getAdapter } = require("./adapter");
const { embedRemoteFileBuffers } = require("../fileSources/indexFiles");
const { MAX_ITEMS_PER_RUN } = require("./constants");

function parseMeta(metadata) {
  if (!metadata) return {};
  if (typeof metadata === "object") return metadata;
  try {
    return JSON.parse(metadata);
  } catch {
    return {};
  }
}

function isDeletedItem(item) {
  return Boolean(
    item?.deleted || item?.removed || item?.trashed || item?.["@removed"]
  );
}

function isFolderItem(item) {
  return (
    item?.type === "folder" || item?.kind === "folder" || Boolean(item?.folder)
  );
}

async function consecutiveFailedCount(sourceId) {
  const runs = await KnowledgeSourceSyncRun.where(
    { sourceId: Number(sourceId) },
    DocumentSyncQueue.maxRepeatFailures,
    { createdAt: "desc" }
  );
  let count = 0;
  for (const run of runs) {
    if (run.status === KnowledgeSourceSyncRun.statuses.failed) count++;
    else break;
  }
  return count;
}

async function removeByChunkSource(workspace, chunkSource) {
  if (!workspace || !chunkSource) return 0;
  const docs = await Document.where({ workspaceId: workspace.id });
  const matches = docs.filter((doc) => {
    const meta = parseMeta(doc.metadata);
    return meta?.chunkSource === chunkSource;
  });
  if (matches.length === 0) return 0;
  await Document.removeDocuments(
    workspace,
    matches.map((doc) => doc.docpath)
  );
  return matches.length;
}

function knownRemoteIdsFor(adapter, docs = []) {
  const prefix = adapter.toChunkSource({ id: "" });
  const ids = new Set();
  if (!prefix) return ids;
  for (const doc of docs) {
    const chunk = parseMeta(doc.metadata)?.chunkSource;
    if (typeof chunk === "string" && chunk.startsWith(prefix)) {
      ids.add(chunk.slice(prefix.length));
    }
  }
  return ids;
}

async function fetchChanges(adapter, source, ctx) {
  return adapter.delta(source.sync_cursor, ctx);
}

/**
 * Sync a single watched knowledge source: delta, download, embed,
 * handle remote deletes, and record the run.
 */
async function syncKnowledgeSource(source, { log = () => {} } = {}) {
  const adapter = getAdapter(source.provider);
  if (!adapter) {
    log(
      `Skipping knowledge source ${source.id} (${source.provider}): no adapter registered.`
    );
    return { skipped: true, reason: "no adapter" };
  }

  const config = KnowledgeSource.decryptConfig(source) || {};
  const workspace = await Workspace.get({ id: Number(source.workspaceId) });
  if (!workspace) {
    throw new Error(`Workspace ${source.workspaceId} not found.`);
  }

  const workspaceDocs = await Document.where({
    workspaceId: workspace.id,
  });
  const ctx = {
    source,
    config,
    folderId: source.remote_id,
    knownRemoteIds: knownRemoteIdsFor(adapter, workspaceDocs),
    log,
  };
  const result = await fetchChanges(adapter, source, ctx);
  const rawItems = result.items || [];
  const overflowed = rawItems.length > MAX_ITEMS_PER_RUN;
  const items = overflowed ? rawItems.slice(0, MAX_ITEMS_PER_RUN) : rawItems;
  const deleted = items.filter(isDeletedItem);
  const changed = items.filter(
    (item) =>
      !isDeletedItem(item) && !isFolderItem(item) && item.indexable !== false
  );

  let removed = 0;
  for (const item of deleted) {
    removed += await removeByChunkSource(
      workspace,
      adapter.toChunkSource(item)
    );
  }

  const files = [];
  let downloadFailed = 0;
  for (const item of changed) {
    try {
      const downloaded = await adapter.download(item, ctx);
      if (!downloaded || downloaded.kind === "folder" || !downloaded.buffer)
        continue;
      files.push({
        ...downloaded,
        id: item.id,
        chunkSource: adapter.toChunkSource(item),
      });
    } catch (e) {
      downloadFailed++;
      log(
        `Failed to download ${item.id} from knowledge source ${source.id} (${source.provider}): ${e.message}`
      );
    }
  }

  for (const file of files) {
    await removeByChunkSource(workspace, file.chunkSource);
  }

  const embedResult =
    files.length > 0
      ? await embedRemoteFileBuffers({
          files,
          workspace,
          docAuthor: source.display_name || source.provider,
          description: `Synced from ${source.display_name || source.provider}`,
          docSource: source.provider,
        })
      : { indexed: 0, failed: 0, locations: [], errors: [] };

  const updates = {
    last_synced_at: new Date(),
    last_error: null,
  };
  // Never persist a terminal cursor after dropping overflow items.
  if (result.cursor !== undefined && !overflowed) {
    updates.sync_cursor = result.cursor;
  }
  if (result.config) updates.config = { ...config, ...result.config };

  await KnowledgeSource.update(source.id, updates);
  await KnowledgeSourceSyncRun.save(
    source.id,
    KnowledgeSourceSyncRun.statuses.success,
    {
      indexed: embedResult.indexed,
      removed,
      failed: embedResult.failed + downloadFailed,
    }
  );

  log(
    `Knowledge source ${source.id} (${source.provider}): indexed ${embedResult.indexed}, removed ${removed}, failed ${embedResult.failed + downloadFailed}.`
  );
  return {
    indexed: embedResult.indexed,
    removed,
    failed: embedResult.failed + downloadFailed,
  };
}

async function markSourceFailed(source, error, { log = () => {} } = {}) {
  const message = error?.message || String(error);
  await KnowledgeSource.update(source.id, { last_error: message });
  await KnowledgeSourceSyncRun.save(
    source.id,
    KnowledgeSourceSyncRun.statuses.failed,
    { reason: message }
  );

  const failedCount = await consecutiveFailedCount(source.id);
  if (failedCount >= DocumentSyncQueue.maxRepeatFailures) {
    await KnowledgeSource.update(source.id, {
      watch_enabled: false,
      last_error: message,
    });
    log(
      `Knowledge source ${source.id} (${source.provider}) failed ${failedCount} times continuously and watch has been disabled.`
    );
    return { disabled: true, failedCount };
  }

  log(
    `Knowledge source ${source.id} (${source.provider}) failed (${failedCount}/${DocumentSyncQueue.maxRepeatFailures}): ${message}`
  );
  return { disabled: false, failedCount };
}

async function syncWatchedKnowledgeSources({ log = () => {} } = {}) {
  const sources = await KnowledgeSource.where({ watch_enabled: true });
  if (sources.length === 0) {
    log("No watched knowledge sources to sync. Exiting.");
    return { synced: 0 };
  }

  const collector = new CollectorApi();
  if (!(await collector.online())) {
    log("Could not reach collector API. Exiting.");
    return { synced: 0, reason: "collector offline" };
  }

  log(`${sources.length} watched knowledge source(s) found; syncing.`);
  let synced = 0;
  for (const source of sources) {
    try {
      const result = await syncKnowledgeSource(source, { log });
      if (!result?.skipped) synced++;
    } catch (e) {
      await markSourceFailed(source, e, { log });
    }
  }
  return { synced };
}

module.exports = {
  MAX_ITEMS_PER_RUN,
  isDeletedItem,
  knownRemoteIdsFor,
  syncKnowledgeSource,
  syncWatchedKnowledgeSources,
  markSourceFailed,
  consecutiveFailedCount,
};
