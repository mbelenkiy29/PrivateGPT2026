const {
  assertAdapter,
  getAdapter,
  unregisterAdapter,
} = require("../../../utils/knowledgeSources/adapter");
const {
  createNotionAdapter,
  NotionAdapter,
  pageTitle,
  renderBlock,
  isTimestampCursor,
  ITEM_CAP,
  STALE_AFTER_MS,
  PROVIDER,
} = require("../../../utils/knowledgeSources/adapters/notion");

function page({
  id,
  title = "Untitled",
  last_edited_time = "2024-06-01T00:00:00.000Z",
  archived = false,
} = {}) {
  return {
    object: "page",
    id,
    last_edited_time,
    archived,
    url: `https://notion.so/${id}`,
    properties: {
      title: {
        type: "title",
        title: [{ plain_text: title, annotations: {} }],
      },
    },
  };
}

function block(type, extras = {}) {
  return {
    id: extras.id || `${type}-1`,
    type,
    has_children: Boolean(extras.has_children),
    [type]: extras.data || extras,
  };
}

function mockClient({
  pages = {},
  blocks = {},
  search = [],
  databases = {},
} = {}) {
  const searchCalls = [];
  return {
    searchCalls,
    async request(method, path, body) {
      if (path === "/users/me") {
        return { id: "user_1", name: "Bot", type: "bot" };
      }
      if (path === "/search") {
        searchCalls.push(body);
        const start = body?.start_cursor
          ? search.findIndex((p) => p.id === body.start_cursor) + 1
          : 0;
        const slice = search.slice(start, start + (body?.page_size || 100));
        const next = search[start + slice.length] || null;
        return {
          results: slice,
          has_more: Boolean(next),
          next_cursor: next ? next.id : null,
        };
      }
      if (method === "GET" && path.startsWith("/pages/")) {
        const id = decodeURIComponent(path.split("/")[2]);
        if (!pages[id]) {
          const err = new Error("not found");
          err.status = 404;
          throw err;
        }
        return pages[id];
      }
      if (method === "GET" && path.startsWith("/databases/")) {
        const id = decodeURIComponent(path.split("/")[2].split("?")[0]);
        if (!databases[id]) {
          const err = new Error("not found");
          err.status = 404;
          throw err;
        }
        return databases[id];
      }
      if (method === "POST" && path.includes("/query")) {
        const id = decodeURIComponent(path.split("/")[2]);
        return { results: databases[id]?.pages || [], has_more: false };
      }
      if (path.includes("/children")) {
        const id = decodeURIComponent(path.split("/")[2]);
        return { results: blocks[id] || [], has_more: false };
      }
      throw new Error(`unexpected ${method} ${path}`);
    },
  };
}

describe("Notion knowledge source adapter", () => {
  it("self-registers as notion and satisfies the contract", () => {
    expect(PROVIDER).toBe("notion");
    expect(() => assertAdapter(NotionAdapter)).not.toThrow();
    expect(getAdapter("notion")).toBeTruthy();
    expect(typeof getAdapter("notion").list).toBe("function");
  });

  it("toChunkSource is notion://pageId", () => {
    const adapter = createNotionAdapter({ token: "tok" });
    expect(adapter.toChunkSource({ id: "abc-123" })).toBe("notion://abc-123");
    expect(adapter.toChunkSource({ pageId: "p1" })).toBe("notion://p1");
  });

  it("watchHint is a 1 hour poll", () => {
    const adapter = createNotionAdapter({});
    expect(adapter.watchHint()).toEqual({
      staleAfterMs: STALE_AFTER_MS,
      poll: true,
    });
    expect(STALE_AFTER_MS).toBe(3600000);
  });

  it("crawls a root page and nested child pages", async () => {
    const pages = {
      root: page({ id: "root", title: "Handbook" }),
      child: page({ id: "child", title: "Time off" }),
    };
    const blocks = {
      root: [
        block("paragraph", {
          data: { rich_text: [{ plain_text: "Welcome", annotations: {} }] },
        }),
        block("child_page", { id: "child", data: { title: "Time off" } }),
      ],
      child: [
        block("heading_1", {
          data: { rich_text: [{ plain_text: "PTO", annotations: {} }] },
        }),
      ],
    };
    const client = mockClient({ pages, blocks });
    const adapter = createNotionAdapter({
      token: "tok",
      pageId: "root",
      client,
    });
    const { items, cursor } = await adapter.list({ folderId: "root" });
    expect(items.map((i) => i.id)).toEqual(["root", "child"]);
    expect(items[0].title).toBe("Handbook");
    expect(cursor).toBe("2024-06-01T00:00:00.000Z");
  });

  it("downloads a page as markdown", async () => {
    const pages = {
      p1: page({ id: "p1", title: "Policy" }),
    };
    const blocks = {
      p1: [
        block("heading_2", {
          data: { rich_text: [{ plain_text: "Rules", annotations: {} }] },
        }),
        block("bulleted_list_item", {
          data: { rich_text: [{ plain_text: "Be kind", annotations: {} }] },
        }),
        block("to_do", {
          data: {
            checked: true,
            rich_text: [{ plain_text: "Done", annotations: {} }],
          },
        }),
      ],
    };
    const adapter = createNotionAdapter({
      token: "tok",
      client: mockClient({ pages, blocks }),
    });
    const downloaded = await adapter.download({ id: "p1" });
    expect(downloaded.mime).toBe("text/markdown");
    expect(downloaded.remoteId).toBe("p1");
    expect(downloaded.name).toBe("Policy.md");
    expect(Buffer.isBuffer(downloaded.buffer)).toBe(true);
    const text = downloaded.buffer.toString("utf8");
    expect(text).toContain("# Policy");
    expect(text).toContain("## Rules");
    expect(text).toContain("- Be kind");
    expect(text).toContain("- [x] Done");
  });

  it("delta with last_edited_time only returns newer pages", async () => {
    const search = [
      page({
        id: "new",
        title: "New",
        last_edited_time: "2024-07-01T00:00:00.000Z",
      }),
      page({
        id: "old",
        title: "Old",
        last_edited_time: "2024-01-01T00:00:00.000Z",
      }),
    ];
    const adapter = createNotionAdapter({
      token: "tok",
      client: mockClient({ search }),
    });
    const { items, cursor } = await adapter.delta("2024-06-01T00:00:00.000Z");
    expect(items.map((i) => i.id)).toEqual(["new"]);
    expect(cursor).toBe("2024-07-01T00:00:00.000Z");
  });

  it("list uses search start_cursor when the cursor is not a timestamp", async () => {
    const search = [
      page({ id: "a", title: "A" }),
      page({ id: "b", title: "B" }),
      page({ id: "c", title: "C" }),
    ];
    const client = mockClient({ search });
    const adapter = createNotionAdapter({ token: "tok", client });
    const { items } = await adapter.list({ cursor: "a" });
    expect(client.searchCalls[0].start_cursor).toBe("a");
    expect(items[0].id).toBe("b");
  });

  it("caps list at 200 items", async () => {
    const search = Array.from({ length: 250 }, (_, i) =>
      page({
        id: `p${i}`,
        title: `Page ${i}`,
        last_edited_time: `2024-06-01T00:00:${String(i % 60).padStart(2, "0")}.000Z`,
      })
    );
    const adapter = createNotionAdapter({
      token: "tok",
      client: mockClient({ search }),
    });
    const { items } = await adapter.list();
    expect(items.length).toBe(ITEM_CAP);
    expect(ITEM_CAP).toBe(200);
  });

  it("pageTitle and renderBlock helpers", () => {
    expect(pageTitle(page({ id: "x", title: "Hello" }))).toBe("Hello");
    expect(
      renderBlock(
        block("heading_1", {
          data: { rich_text: [{ plain_text: "Hi", annotations: {} }] },
        })
      )
    ).toBe("# Hi");
    expect(isTimestampCursor("2024-06-01T00:00:00.000Z")).toBe(true);
    expect(isTimestampCursor("abc-not-a-date")).toBe(false);
  });

  it("list without a token fails closed", async () => {
    const adapter = createNotionAdapter({});
    await expect(adapter.list()).rejects.toThrow(/token is required/);
  });
});

afterAll(() => {
  // Keep the self-registered adapter for other files; only drop test fakes.
  unregisterAdapter("broken");
});
