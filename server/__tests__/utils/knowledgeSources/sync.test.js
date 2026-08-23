/* eslint-env jest */
const fs = require("fs");
const path = require("path");

const mockGetAdapter = jest.fn();

jest.mock("../../../models/knowledgeSource", () => ({
  KnowledgeSource: {
    where: jest.fn(),
    update: jest.fn(),
    decryptConfig: jest.fn(() => ({})),
  },
}));
jest.mock("../../../models/knowledgeSourceSyncRun", () => ({
  KnowledgeSourceSyncRun: {
    statuses: {
      success: "success",
      failed: "failed",
      unknown: "unknown",
      exited: "exited",
    },
    save: jest.fn().mockResolvedValue({ id: 1 }),
    where: jest.fn().mockResolvedValue([]),
  },
}));
jest.mock("../../../models/documentSyncQueue", () => ({
  DocumentSyncQueue: { maxRepeatFailures: 5 },
}));
jest.mock("../../../models/workspace", () => ({
  Workspace: { get: jest.fn() },
}));
jest.mock("../../../models/documents", () => ({
  Document: {
    where: jest.fn().mockResolvedValue([]),
    removeDocuments: jest.fn(),
  },
}));
jest.mock("../../../utils/collectorApi", () => ({
  CollectorApi: jest.fn(() => ({
    online: jest.fn().mockResolvedValue(true),
  })),
}));
jest.mock("../../../utils/fileSources/indexFiles", () => ({
  embedRemoteFileBuffers: jest.fn().mockResolvedValue({
    indexed: 1,
    failed: 0,
    locations: ["custom-documents/a.json"],
    errors: [],
  }),
}));
jest.mock("../../../utils/knowledgeSources/adapter", () => ({
  getAdapter: (...args) => mockGetAdapter(...args),
}));

const { KnowledgeSource } = require("../../../models/knowledgeSource");
const {
  KnowledgeSourceSyncRun,
} = require("../../../models/knowledgeSourceSyncRun");
const { Workspace } = require("../../../models/workspace");
const { Document } = require("../../../models/documents");
const { CollectorApi } = require("../../../utils/collectorApi");
const {
  embedRemoteFileBuffers,
} = require("../../../utils/fileSources/indexFiles");
const {
  syncWatchedKnowledgeSources,
  MAX_ITEMS_PER_RUN,
} = require("../../../utils/knowledgeSources/sync");

const source = {
  id: 7,
  provider: "google-drive",
  workspaceId: 3,
  remote_id: "folder-1",
  display_name: "Specs",
  sync_cursor: "c1",
  watch_enabled: true,
  encrypted_config: null,
};
const workspace = { id: 3, slug: "team" };

function makeAdapter(overrides = {}) {
  return {
    async list() {
      return { items: [], cursor: null };
    },
    async download(item) {
      return {
        kind: "file",
        name: `${item.id}.txt`,
        buffer: Buffer.from("hello"),
      };
    },
    async delta() {
      return { items: [], cursor: "c2" };
    },
    watchHint() {
      return { staleAfterMs: 3600000 };
    },
    toChunkSource(item) {
      return `gdrive://${item.id}`;
    },
    ...overrides,
  };
}

describe("syncWatchedKnowledgeSources", () => {
  const log = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    KnowledgeSource.where.mockResolvedValue([source]);
    KnowledgeSource.update.mockResolvedValue(source);
    KnowledgeSource.decryptConfig.mockReturnValue({});
    KnowledgeSourceSyncRun.where.mockResolvedValue([]);
    Workspace.get.mockResolvedValue(workspace);
    Document.where.mockResolvedValue([]);
    CollectorApi.mockImplementation(() => ({
      online: jest.fn().mockResolvedValue(true),
    }));
    embedRemoteFileBuffers.mockResolvedValue({
      indexed: 1,
      failed: 0,
      locations: ["custom-documents/a.json"],
      errors: [],
    });
  });

  it("job file loads adapters via register and does not say sync is unimplemented", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../../jobs/sync-knowledge-sources.js"),
      "utf8"
    );
    expect(src).toMatch(/knowledgeSources\/register/);
    expect(src).not.toMatch(/sync not implemented/i);
  });

  it("sync-watched-documents loads adapters so extraFileTypes skip gdrive/onedrive", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../../../jobs/sync-watched-documents.js"),
      "utf8"
    );
    expect(src).toMatch(/knowledgeSources\/register/);
  });

  it("skips sources with no adapter registered", async () => {
    mockGetAdapter.mockReturnValue(null);
    await syncWatchedKnowledgeSources({ log });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("no adapter registered")
    );
    expect(embedRemoteFileBuffers).not.toHaveBeenCalled();
  });

  it("downloads changed items, embeds them, and handles deleted remote ids", async () => {
    const adapter = makeAdapter({
      delta: jest.fn().mockResolvedValue({
        items: [
          { id: "abc", name: "doc.txt", type: "file" },
          { id: "gone", deleted: true },
        ],
        cursor: "c2",
      }),
      download: jest.fn().mockResolvedValue({
        kind: "file",
        name: "doc.txt",
        buffer: Buffer.from("hello"),
      }),
    });
    mockGetAdapter.mockReturnValue(adapter);
    Document.where.mockResolvedValue([
      {
        id: 9,
        docpath: "custom-documents/old.json",
        metadata: JSON.stringify({ chunkSource: "gdrive://gone" }),
      },
    ]);

    await syncWatchedKnowledgeSources({ log });

    expect(adapter.delta).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({
        knownRemoteIds: expect.any(Set),
      })
    );
    expect(adapter.download).toHaveBeenCalledWith(
      expect.objectContaining({ id: "abc" }),
      expect.any(Object)
    );
    expect(Document.removeDocuments).toHaveBeenCalledWith(workspace, [
      "custom-documents/old.json",
    ]);
    expect(embedRemoteFileBuffers).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace,
        files: [
          expect.objectContaining({
            name: "doc.txt",
            chunkSource: "gdrive://abc",
          }),
        ],
      })
    );
    expect(KnowledgeSource.update).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        sync_cursor: "c2",
        last_error: null,
      })
    );
    expect(KnowledgeSourceSyncRun.save).toHaveBeenCalledWith(
      7,
      "success",
      expect.objectContaining({ indexed: 1, removed: 1 })
    );
    expect(log.mock.calls.flat().join("\n")).not.toMatch(
      /sync not implemented/i
    );
  });

  it("caps processing at 200 items per run and does not persist a terminal overflow cursor", async () => {
    const download = jest.fn().mockResolvedValue({
      kind: "file",
      name: "doc.txt",
      buffer: Buffer.from("x"),
    });
    mockGetAdapter.mockReturnValue(
      makeAdapter({
        delta: jest.fn().mockResolvedValue({
          items: Array.from({ length: 250 }, (_, i) => ({
            id: `f${i}`,
            name: `f${i}.txt`,
            type: "file",
          })),
          cursor: "END",
        }),
        download,
      })
    );

    await syncWatchedKnowledgeSources({ log });

    expect(MAX_ITEMS_PER_RUN).toBe(200);
    expect(download).toHaveBeenCalledTimes(200);
    const updatePayloads = KnowledgeSource.update.mock.calls.map(
      ([, data]) => data
    );
    expect(updatePayloads.some((data) => data.sync_cursor === "END")).toBe(
      false
    );
  });

  it("continues after a per-item download error and skips non-indexable files", async () => {
    const download = jest.fn().mockImplementation(async (item) => {
      if (item.id === "bad") throw new Error("export failed");
      return {
        kind: "file",
        name: `${item.id}.txt`,
        buffer: Buffer.from("ok"),
      };
    });
    mockGetAdapter.mockReturnValue(
      makeAdapter({
        delta: jest.fn().mockResolvedValue({
          items: [
            { id: "bad", name: "bad.pdf", type: "file" },
            { id: "img", name: "pic.png", type: "file", indexable: false },
            { id: "good", name: "good.txt", type: "file" },
          ],
          cursor: "c2",
        }),
        download,
      })
    );

    await syncWatchedKnowledgeSources({ log });

    expect(download).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: "img" }),
      expect.anything()
    );
    expect(embedRemoteFileBuffers).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [expect.objectContaining({ chunkSource: "gdrive://good" })],
      })
    );
    expect(KnowledgeSource.update).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ sync_cursor: "c2", last_error: null })
    );
    expect(KnowledgeSourceSyncRun.save).toHaveBeenCalledWith(
      7,
      "success",
      expect.objectContaining({ failed: 1, indexed: 1 })
    );
  });

  it("does not fall back to list when delta throws", async () => {
    const list = jest.fn();
    mockGetAdapter.mockReturnValue(
      makeAdapter({
        delta: jest.fn().mockRejectedValue(new Error("Drive down")),
        list,
      })
    );
    KnowledgeSourceSyncRun.where.mockResolvedValue([]);

    await syncWatchedKnowledgeSources({ log });

    expect(list).not.toHaveBeenCalled();
    expect(KnowledgeSourceSyncRun.save).toHaveBeenCalledWith(
      7,
      "failed",
      expect.objectContaining({ reason: "Drive down" })
    );
  });

  it("disables watch after 5 consecutive failed runs", async () => {
    mockGetAdapter.mockReturnValue(
      makeAdapter({
        delta: jest.fn().mockRejectedValue(new Error("Drive down")),
        list: jest.fn(),
      })
    );
    KnowledgeSourceSyncRun.where.mockResolvedValue(
      Array.from({ length: 5 }, () => ({ status: "failed" }))
    );

    await syncWatchedKnowledgeSources({ log });

    expect(KnowledgeSourceSyncRun.save).toHaveBeenCalledWith(
      7,
      "failed",
      expect.objectContaining({ reason: "Drive down" })
    );
    expect(KnowledgeSource.update).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ watch_enabled: false })
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("watch has been disabled")
    );
  });
});
