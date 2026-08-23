const fs = require("fs");
const path = require("path");
const { v4 } = require("uuid");
const { CollectorApi } = require("../collectorApi");
const { hotdirPath } = require("../files");
const { Workspace } = require("../../models/workspace");
const { Document } = require("../../models/documents");

function safeName(name = "file") {
  return String(name)
    .replace(/[\\/]/g, "_")
    .replace(/[^\w.\- ()]/g, "_")
    .slice(0, 120);
}

async function collectFileIds(adapter, record, items, acc = [], depth = 0) {
  for (const item of items) {
    if (acc.length >= 50) break;
    if (item.type === "file" && item.indexable !== false) {
      acc.push({ id: item.id, name: item.name });
      continue;
    }
    if (item.type === "folder" && depth < 4) {
      const { items: children } = await adapter.listChildren(record, item.id);
      await collectFileIds(adapter, record, children, acc, depth + 1);
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
 * Download selected remote files, parse them via the collector, and embed
 * into the given workspace.
 */
async function indexRemoteFiles({ adapter, record, fileIds, workspaceSlug }) {
  const workspace = await Workspace.get({ slug: workspaceSlug });
  if (!workspace) throw new Error("Workspace not found.");

  const collected = [];
  for (const fileId of fileIds.slice(0, 50)) {
    const downloaded = await adapter.download(record, fileId);
    if (downloaded.kind === "folder") {
      const nested = await collectFileIds(adapter, record, downloaded.children);
      for (const child of nested) {
        const file = await adapter.download(record, child.id);
        if (file.kind === "file") collected.push(file);
      }
    } else {
      collected.push(downloaded);
    }
  }

  const collector = new CollectorApi();
  const locations = [];
  const errors = [];

  for (const file of collected) {
    try {
      const filename = await writeToHotdir(file.name, file.buffer);
      const processed = await collector.processDocument(filename, {
        title: file.name,
        docAuthor: record.account_email || record.provider,
        description: `Imported from ${record.provider}`,
        docSource: record.provider,
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

module.exports = { indexRemoteFiles };
