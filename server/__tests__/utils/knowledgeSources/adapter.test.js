const {
  assertAdapter,
  registerAdapter,
  getAdapter,
  listProviders,
  unregisterAdapter,
} = require("../../../utils/knowledgeSources");

function makeFakeAdapter(overrides = {}) {
  return {
    async list({ cursor, folderId } = {}) {
      return { items: [], cursor: cursor || null, folderId: folderId || null };
    },
    async download(item) {
      return item;
    },
    async delta(_cursor) {
      return {
        items: [
          { id: "abc", title: "Changed doc" },
          { id: "def", title: "Another doc" },
        ],
        cursor: "c1",
      };
    },
    watchHint() {
      return { poll: true };
    },
    toChunkSource(item) {
      return `fake://${item.id}`;
    },
    ...overrides,
  };
}

describe("KnowledgeSourceAdapter contract", () => {
  const provider = "fake";

  afterEach(() => {
    unregisterAdapter(provider);
    unregisterAdapter("broken");
  });

  it("registers and returns a fake adapter that implements the contract", () => {
    const adapter = makeFakeAdapter();
    expect(() => assertAdapter(adapter)).not.toThrow();
    registerAdapter(provider, adapter);
    expect(getAdapter(provider)).toBe(adapter);
    expect(listProviders()).toContain(provider);
  });

  it("delta returns changed items that map to documents with chunkSource", async () => {
    const adapter = makeFakeAdapter();
    registerAdapter(provider, adapter);

    const { items } = await adapter.delta();
    expect(items.length).toBeGreaterThan(0);

    const documents = items.map((item) => ({
      ...item,
      chunkSource: adapter.toChunkSource(item),
    }));

    expect(documents[0].chunkSource).toBe("fake://abc");
    expect(documents[1].chunkSource).toBe("fake://def");
    expect(documents.every((doc) => typeof doc.chunkSource === "string")).toBe(
      true
    );
  });

  it("toChunkSource returns strings like fake://id", () => {
    const adapter = makeFakeAdapter();
    expect(adapter.toChunkSource({ id: "xyz" })).toBe("fake://xyz");
  });

  it("list, download, and watchHint are callable on a fake adapter", async () => {
    const adapter = makeFakeAdapter();
    const listed = await adapter.list({ cursor: "c0", folderId: "f1" });
    expect(listed).toEqual({ items: [], cursor: "c0", folderId: "f1" });
    const item = { id: "abc" };
    expect(await adapter.download(item)).toBe(item);
    expect(adapter.watchHint()).toEqual({ poll: true });
  });

  it("assertAdapter rejects incomplete objects", () => {
    expect(() => assertAdapter(null)).toThrow(
      "Knowledge source adapter must be an object"
    );
    expect(() => assertAdapter({})).toThrow(
      /missing required methods: list, download, delta, watchHint, toChunkSource/
    );
    expect(() =>
      assertAdapter({
        list: async () => ({ items: [] }),
        download: async (item) => item,
      })
    ).toThrow(/missing required methods: delta, watchHint, toChunkSource/);
  });

  it("assertAdapter rejects non-function methods", () => {
    expect(() =>
      assertAdapter({
        ...makeFakeAdapter(),
        list: "nope",
      })
    ).toThrow(/missing required methods: list/);
  });

  it("registerAdapter rejects incomplete adapters", () => {
    expect(() => registerAdapter("broken", { list: () => {} })).toThrow(
      /missing required methods/
    );
    expect(getAdapter("broken")).toBeNull();
  });

  it("getAdapter returns null for unknown providers", () => {
    expect(getAdapter("does-not-exist")).toBeNull();
  });

  it("barrel self-registers notion and dropbox adapters", () => {
    expect(listProviders()).toEqual(
      expect.arrayContaining(["notion", "dropbox"])
    );
    expect(getAdapter("notion").toChunkSource({ id: "p1" })).toBe(
      "notion://p1"
    );
    expect(
      getAdapter("dropbox").toChunkSource({ path_display: "/Inbox/a.pdf" })
    ).toBe("dropbox://Inbox/a.pdf");
    expect(getAdapter("notion").watchHint().staleAfterMs).toBe(3600000);
    expect(getAdapter("dropbox").watchHint().staleAfterMs).toBe(3600000);
  });
});
