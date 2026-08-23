const {
  assertAdapter,
  getAdapter,
} = require("../../../utils/knowledgeSources/adapter");
const {
  createDropboxAdapter,
  DropboxAdapter,
  mapEntry,
  normalizePath,
  collectEntries,
  storedTokens,
  ITEM_CAP,
  STALE_AFTER_MS,
  PROVIDER,
} = require("../../../utils/knowledgeSources/adapters/dropbox");

function file(path, extras = {}) {
  const name = path.split("/").pop();
  return {
    ".tag": extras.tag || "file",
    id: extras.id || `id:${name}`,
    name,
    path_display: path,
    path_lower: path.toLowerCase(),
    size: extras.size || 10,
    server_modified: extras.modified || "2024-06-01T00:00:00Z",
  };
}

function mockClient({ folders = {}, continues = {}, downloads = {} } = {}) {
  const rpcCalls = [];
  let includeDeleted = true;
  return {
    rpcCalls,
    async rpc(endpoint, body) {
      rpcCalls.push({ endpoint, body });
      if (endpoint === "files/list_folder") {
        includeDeleted = body.include_deleted !== false;
        const key = body.path || "";
        const payload = folders[key];
        if (!payload) throw new Error(`no folder ${key}`);
        return payload;
      }
      if (endpoint === "files/list_folder/continue") {
        const payload = continues[body.cursor];
        if (!payload) throw new Error(`no cursor ${body.cursor}`);
        if (includeDeleted) return payload;
        return {
          ...payload,
          entries: (payload.entries || []).filter(
            (entry) => entry[".tag"] !== "deleted"
          ),
        };
      }
      if (endpoint === "users/get_current_account") {
        return { email: "a@b.com", name: { display_name: "Ada" } };
      }
      throw new Error(`unexpected rpc ${endpoint}`);
    },
    async download(path) {
      const payload = downloads[path];
      if (!payload) throw new Error(`no download ${path}`);
      return payload;
    },
  };
}

describe("Dropbox knowledge source adapter", () => {
  it("self-registers as dropbox and satisfies the contract", () => {
    expect(PROVIDER).toBe("dropbox");
    expect(() => assertAdapter(DropboxAdapter)).not.toThrow();
    expect(getAdapter("dropbox")).toBeTruthy();
  });

  it("toChunkSource is dropbox://path without a leading slash", () => {
    const adapter = createDropboxAdapter({ accessToken: "tok" });
    expect(adapter.toChunkSource({ path_display: "/Inbox/a.pdf" })).toBe(
      "dropbox://Inbox/a.pdf"
    );
    expect(adapter.toChunkSource({ path: "Notes/readme.md" })).toBe(
      "dropbox://Notes/readme.md"
    );
  });

  it("watchHint is a 1 hour poll", () => {
    expect(createDropboxAdapter({}).watchHint()).toEqual({
      staleAfterMs: STALE_AFTER_MS,
      poll: true,
    });
    expect(STALE_AFTER_MS).toBe(3600000);
  });

  it("lists a folder and follows list_folder/continue, returning the native cursor", async () => {
    const client = mockClient({
      folders: {
        "/Docs": {
          entries: [file("/Docs/one.txt"), file("/Docs/two.txt")],
          cursor: "c1",
          has_more: true,
        },
      },
      continues: {
        c1: {
          entries: [file("/Docs/three.txt")],
          cursor: "c2",
          has_more: false,
        },
      },
    });
    const adapter = createDropboxAdapter({
      accessToken: "tok",
      path: "/Docs",
      client,
    });
    const { items, cursor } = await adapter.list({ folderId: "/Docs" });
    expect(items.map((i) => i.name)).toEqual([
      "one.txt",
      "two.txt",
      "three.txt",
    ]);
    expect(cursor).toBe("c2");
    expect(client.rpcCalls[0].endpoint).toBe("files/list_folder");
    expect(client.rpcCalls[1].endpoint).toBe("files/list_folder/continue");
    expect(client.rpcCalls[1].body.cursor).toBe("c1");
  });

  it("delta with a native cursor continues and surfaces deleted entries", async () => {
    const client = mockClient({
      continues: {
        c2: {
          entries: [
            file("/Docs/four.txt"),
            {
              ".tag": "deleted",
              name: "two.txt",
              path_display: "/Docs/two.txt",
            },
          ],
          cursor: "c3",
          has_more: false,
        },
      },
    });
    const adapter = createDropboxAdapter({
      accessToken: "tok",
      client,
    });
    const { items, cursor } = await adapter.delta("c2");
    expect(cursor).toBe("c3");
    expect(items.filter((i) => !i.deleted).map((i) => i.name)).toEqual([
      "four.txt",
    ]);
    expect(items.filter((i) => i.deleted).map((i) => i.path)).toEqual([
      "/Docs/two.txt",
    ]);
  });

  it("downloads a file as a buffer for the collector", async () => {
    const buffer = Buffer.from("hello world");
    const client = mockClient({
      downloads: {
        "/Docs/one.txt": {
          buffer,
          meta: {
            name: "one.txt",
            id: "id:one",
            path_display: "/Docs/one.txt",
            server_modified: "2024-06-02T00:00:00Z",
          },
        },
      },
    });
    const adapter = createDropboxAdapter({ accessToken: "tok", client });
    const downloaded = await adapter.download({
      path_display: "/Docs/one.txt",
      name: "one.txt",
    });
    expect(Buffer.isBuffer(downloaded.buffer)).toBe(true);
    expect(downloaded.buffer.toString()).toBe("hello world");
    expect(downloaded.name).toBe("one.txt");
    expect(downloaded.remoteId).toBe("id:one");
    expect(downloaded.mime).toBe("text/plain");
  });

  it("caps list at 200 items but still drains the native cursor", async () => {
    const first = Array.from({ length: 150 }, (_, i) =>
      file(`/Docs/f${i}.txt`)
    );
    const rest = Array.from({ length: 80 }, (_, i) => file(`/Docs/g${i}.txt`));
    const client = mockClient({
      folders: {
        "/Docs": { entries: first, cursor: "c1", has_more: true },
      },
      continues: {
        c1: { entries: rest, cursor: "c-final", has_more: false },
      },
    });
    const adapter = createDropboxAdapter({
      accessToken: "tok",
      path: "/Docs",
      client,
    });
    const { items, cursor } = await adapter.list({ folderId: "/Docs" });
    expect(items.length).toBe(ITEM_CAP);
    expect(ITEM_CAP).toBe(200);
    expect(cursor).toBe("c-final");
    expect(
      client.rpcCalls.some((c) => c.endpoint === "files/list_folder/continue")
    ).toBe(true);
  });

  it("listChildren is non-recursive for the folder picker", async () => {
    const client = mockClient({
      folders: {
        "": {
          entries: [
            {
              ".tag": "folder",
              name: "Docs",
              path_display: "/Docs",
              id: "id:docs",
            },
            file("/readme.md"),
          ],
          cursor: "root",
          has_more: false,
        },
      },
    });
    const adapter = createDropboxAdapter({ accessToken: "tok", client });
    const { items } = await adapter.listChildren("");
    expect(items.map((i) => i.type)).toEqual(["folder", "file"]);
    expect(client.rpcCalls[0].body.recursive).toBe(false);
  });

  it("normalizePath and mapEntry helpers", () => {
    expect(normalizePath("root")).toBe("");
    expect(normalizePath("/Inbox")).toBe("/Inbox");
    expect(normalizePath("Inbox")).toBe("/Inbox");
    expect(mapEntry(file("/a.pdf")).indexable).toBe(true);
    expect(mapEntry(file("/a.exe")).indexable).toBe(false);
  });

  it("list without a token fails closed", async () => {
    const adapter = createDropboxAdapter({});
    await expect(adapter.list()).rejects.toThrow(/access token is required/);
  });

  it("delta(null) sets include_deleted so later continue reports removals", async () => {
    const client = mockClient({
      folders: {
        "/Docs": {
          entries: [file("/Docs/one.txt")],
          cursor: "c1",
          has_more: true,
        },
      },
      continues: {
        c1: {
          entries: [
            {
              ".tag": "deleted",
              name: "gone.txt",
              path_display: "/Docs/gone.txt",
            },
          ],
          cursor: "c2",
          has_more: false,
        },
      },
    });
    const adapter = createDropboxAdapter({
      accessToken: "tok",
      path: "/Docs",
      client,
    });
    const { items, cursor } = await adapter.delta(null);
    expect(client.rpcCalls[0].body.include_deleted).toBe(true);
    expect(cursor).toBe("c2");
    expect(items.filter((i) => i.deleted).map((i) => i.path)).toEqual([
      "/Docs/gone.txt",
    ]);
  });

  it("continue omits deletes when the original list_folder set include_deleted false", async () => {
    const client = mockClient({
      folders: {
        "/Docs": {
          entries: [file("/Docs/one.txt")],
          cursor: "c1",
          has_more: true,
        },
      },
      continues: {
        c1: {
          entries: [
            file("/Docs/two.txt"),
            {
              ".tag": "deleted",
              name: "gone.txt",
              path_display: "/Docs/gone.txt",
            },
          ],
          cursor: "c2",
          has_more: false,
        },
      },
    });
    const listed = await collectEntries(client, {
      path: "/Docs",
      recursive: true,
      includeDeleted: false,
    });
    expect(client.rpcCalls[0].body.include_deleted).toBe(false);
    expect(listed.items.map((i) => i.name)).toEqual(["one.txt", "two.txt"]);
    expect(listed.items.some((i) => i.deleted)).toBe(false);
  });

  it("keeps deletions past the 200 live-file cap while draining the cursor", async () => {
    const first = Array.from({ length: 150 }, (_, i) =>
      file(`/Docs/f${i}.txt`)
    );
    const restFiles = Array.from({ length: 80 }, (_, i) =>
      file(`/Docs/g${i}.txt`)
    );
    const restDeletes = Array.from({ length: 5 }, (_, i) => ({
      ".tag": "deleted",
      name: `old${i}.txt`,
      path_display: `/Docs/old${i}.txt`,
    }));
    const client = mockClient({
      folders: {
        "/Docs": { entries: first, cursor: "c1", has_more: true },
      },
      continues: {
        c1: {
          entries: [...restFiles, ...restDeletes],
          cursor: "c-final",
          has_more: false,
        },
      },
    });
    const adapter = createDropboxAdapter({
      accessToken: "tok",
      path: "/Docs",
      client,
    });
    const { items, cursor } = await adapter.delta(null);
    expect(items.filter((i) => !i.deleted)).toHaveLength(ITEM_CAP);
    expect(items.filter((i) => i.deleted)).toHaveLength(5);
    expect(cursor).toBe("c-final");
  });

  it("refreshes using snake_case refresh_token from stored config", async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async (url) => {
      if (String(url).includes("oauth2/token")) {
        return {
          ok: true,
          text: async () =>
            JSON.stringify({ access_token: "fresh", expires_in: 14400 }),
        };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const rpc = jest.fn(async () => ({
      entries: [],
      cursor: "c",
      has_more: false,
    }));
    try {
      const adapter = createDropboxAdapter({
        access_token: "stale",
        refresh_token: "rt",
        token_expires_at: Date.now() - 1000,
        clientId: "id",
        clientSecret: "secret",
        path: "/Docs",
        client: { rpc, download: async () => ({}) },
      });
      await adapter.list({ folderId: "/Docs" });
      expect(global.fetch).toHaveBeenCalled();
      expect(rpc).toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("storedTokens reads snake_case knowledge_sources config", () => {
    expect(
      storedTokens({
        access_token: "a",
        refresh_token: "r",
        token_expires_at: 1,
      })
    ).toEqual({
      accessToken: "a",
      refreshToken: "r",
      expiresAt: 1,
      clientId: null,
      clientSecret: null,
    });
  });
});
