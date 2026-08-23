const fs = require("fs");
const path = require("path");
const { v4 } = require("uuid");
const { CollectorApi } = require("../collectorApi");
const { hotdirPath } = require("../files");
const { Workspace } = require("../../models/workspace");
const { Document } = require("../../models/documents");
const { MAX_ITEMS_PER_RUN } = require("../knowledgeSources/constants");

function safeName(name = "file") {
  return String(name)
    .replace(/[\\/]/g, "_")
    .replace(/[^\w.\- ()]/g, "_")
    .slice(0, 120);
}

function chunkSourceFor(provider, fileId) {
  if (provider === "google-drive") return `gdrive://${fileId}`;
  return `${provider}://${fileId}`;
}

async function collectFileIds(
  adapter,
  record,
  items,
  acc = [],
  depth = 0,
  folderIds = []
) {
  for (const item of items) {
    if (acc.length >= MAX_ITEMS_PER_RUN) break;
    if (item.type === "file" && item.indexable !== false) {
      acc.push({ id: item.id, name: item.name });
      continue;
    }
    if (item.type === "folder" && depth < 4) {
      folderIds.push(item.id);
      const { items: children } = await adapter.listChildren(record, item.id);
      await collectFileIds(
        adapter,
        record,
        children,
        acc,
        depth + 1,
        folderIds
      );
    }
  }
  return acc;
}

async function writeToHotdir(filename, buffer) {
  if (!fs.existsSync(hotdirPath)) fs.mkdirSync(hotdirPath, { recursive: true });
  const unique = `${v4().slice(0, 8)}-${safeName(filename)}`;
  const dest = path.join(hotdirPath, unique);
  fs.writeFileSync(dest, buffer);
  return unique;
}

/**
 * Write buffers to the collector hotdir, parse them, and embed into workspace.
 */
async function embedRemoteFileBuffers({
  files,
  workspace,
  docAuthor,
  description,
  docSource,
}) {
  const collector = new CollectorApi();
  const locations = [];
  const errors = [];

  for (const file of files.slice(0, MAX_ITEMS_PER_RUN)) {
    if (!file?.buffer) continue;
    try {
      const filename = await writeToHotdir(file.name, file.buffer);
      const processed = await collector.processDocument(filename, {
        title: file.name,
        docAuthor,
        description,
        docSource: file.chunkSource || docSource,
        chunkSource: file.chunkSource || "",
      });
      if (!processed?.success || !processed.documents?.length) {
        errors.push({
          name: file.name,
          error: processed?.reason || "Could not parse file",
        });
        continue;
      }
      for (const doc of processed.documents) {
        if (doc.location) locations.push(doc.location);
      }
    } catch (e) {
      errors.push({ name: file.name, error: e.message });
    }
  }

  if (locations.length > 0) {
    await Document.addDocuments(workspace, locations);
  }

  return {
    indexed: locations.length,
    failed: errors.length,
    locations,
    errors,
  };
}

/**
 * Download selected remote files, parse them via the collector, and embed
 * into the given workspace.
 */
async function indexRemoteFiles({ adapter, record, fileIds, workspaceSlug }) {
  const workspace = await Workspace.get({ slug: workspaceSlug });
  if (!workspace) throw new Error("Workspace not found.");

  const collected = [];
  const folders = [];
  for (const fileId of fileIds.slice(0, MAX_ITEMS_PER_RUN)) {
    const downloaded = await adapter.download(record, fileId);
    if (downloaded.kind === "folder") {
      const nestedFolderIds = [];
      folders.push({
        id: fileId,
        name: downloaded.name,
        folderIds: nestedFolderIds,
      });
      const nested = await collectFileIds(
        adapter,
        record,
        downloaded.children,
        [],
        0,
        nestedFolderIds
      );
      for (const child of nested) {
        if (collected.length >= MAX_ITEMS_PER_RUN) break;
        const file = await adapter.download(record, child.id);
        if (file.kind === "file")
          collected.push({
            ...file,
            id: child.id,
            chunkSource: chunkSourceFor(record.provider, child.id),
          });
      }
    } else {
      collected.push({
        ...downloaded,
        id: fileId,
        chunkSource: chunkSourceFor(record.provider, fileId),
      });
    }
  }

  const result = await embedRemoteFileBuffers({
    files: collected,
    workspace,
    docAuthor: record.account_email || record.provider,
    description: `Imported from ${record.provider}`,
    docSource: record.provider,
  });

  return { ...result, folders };
}

module.exports = {
  indexRemoteFiles,
  embedRemoteFileBuffers,
  chunkSourceFor,
  MAX_REMOTE_FILES: MAX_ITEMS_PER_RUN,
};
