/* eslint-env jest */
process.env.SIG_KEY = process.env.SIG_KEY || "a".repeat(64);
process.env.SIG_SALT = process.env.SIG_SALT || "b".repeat(64);

const {
  assertAdapter,
  getAdapter,
  listProviders,
} = require("../../../../utils/knowledgeSources");
const { DocumentSyncQueue } = require("../../../../models/documentSyncQueue");
const {
  adapter,
  createSlackAdapter,
  PROVIDER,
  STALE_AFTER_MS,
  BOT_SCOPES,
  USER_SCOPES,
} = require("../../../../utils/knowledgeSources/adapters/slack");

const CHANNEL = "C123ABC";
const TOKEN = "xoxb-test-token";
const MESSAGE_A = {
  type: "message",
  user: "U1",
  text: "Hello team",
  ts: "1710000000.000100",
};
const MESSAGE_B = {
  type: "message",
  user: "U2",
  text: "Status update",
  ts: "1710000001.000200",
  files: [{ id: "F99", name: "notes.txt" }],
};

function jsonResponse(body, { status = 200, retryAfter = null } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    headers: {
      get: (name) =>
        String(name).toLowerCase() === "retry-after" ? retryAfter : null,
    },
  };
}

describe("Slack knowledge source adapter", () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = jest.fn(async (url) => {
      const href = String(url);
      if (href.includes("conversations.history")) {
        return jsonResponse({
          ok: true,
          messages: [MESSAGE_B, MESSAGE_A],
          response_metadata: { next_cursor: "" },
        });
      }
      if (href.includes("conversations.replies")) {
        return jsonResponse({
          ok: true,
          messages: [MESSAGE_A, MESSAGE_B],
        });
      }
      if (href.includes("files.info")) {
        return jsonResponse({
          ok: true,
          file: {
            id: "F99",
            name: "notes.txt",
            title: "notes.txt",
            mimetype: "text/plain",
            permalink: "https://slack.com/files/F99",
            preview: "attachment preview",
          },
        });
      }
      return jsonResponse({ ok: true });
    });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it("registers at module load and implements the contract", () => {
    expect(() => assertAdapter(adapter)).not.toThrow();
    expect(getAdapter(PROVIDER)).toBe(adapter);
    expect(listProviders()).toContain(PROVIDER);
    expect(DocumentSyncQueue.extraFileTypes).toContain(PROVIDER);
    expect(DocumentSyncQueue.canWatch({ chunkSource: "slack://C1/1.2" })).toBe(
      true
    );
  });

  it("lists history messages and maps them to slack://CHANNEL/TS chunk sources", async () => {
    const bound = createSlackAdapter({
      accessToken: TOKEN,
      channelId: CHANNEL,
    });
    const listed = await bound.list();
    expect(listed.items).toHaveLength(2);

    const documents = listed.items.map((item) => ({
      ...item,
      chunkSource: bound.toChunkSource(item),
    }));
    expect(documents.map((doc) => doc.chunkSource)).toEqual([
      `slack://${CHANNEL}/${MESSAGE_B.ts}`,
      `slack://${CHANNEL}/${MESSAGE_A.ts}`,
    ]);

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    const joinAt = urls.findIndex((url) => url.includes("conversations.join"));
    const historyAt = urls.findIndex((url) =>
      url.includes("conversations.history")
    );
    expect(joinAt).toBeGreaterThan(-1);
    expect(historyAt).toBeGreaterThan(joinAt);
    expect(urls[historyAt]).toContain(`channel=${CHANNEL}`);
    expect(urls[historyAt]).toContain("limit=200");
  });

  it("downloads a two-message thread as markdown including files.info", async () => {
    const bound = createSlackAdapter({
      accessToken: TOKEN,
      channelId: CHANNEL,
    });
    const file = await bound.download({
      ts: MESSAGE_A.ts,
      thread_ts: MESSAGE_A.ts,
      reply_count: 1,
      text: MESSAGE_A.text,
      user: MESSAGE_A.user,
      files: MESSAGE_B.files,
    });

    expect(file.mime).toBe("text/markdown");
    expect(Buffer.isBuffer(file.buffer)).toBe(true);
    const markdown = file.buffer.toString("utf8");
    expect(markdown).toContain("Hello team");
    expect(markdown).toContain("Status update");
    expect(markdown).toContain("notes.txt");
    expect(markdown).toContain("attachment preview");
    expect(file.name).toContain(CHANNEL);
    expect(bound.toChunkSource({ channelId: CHANNEL, ts: MESSAGE_A.ts })).toBe(
      `slack://${CHANNEL}/${MESSAGE_A.ts}`
    );
  });

  it("delta pages conversations.history with oldest=sync_cursor", async () => {
    const bound = createSlackAdapter({
      accessToken: TOKEN,
      channelId: CHANNEL,
    });
    const cursor = "1700000000.000000";
    const result = await bound.delta(cursor);
    expect(result.items.length).toBeGreaterThan(0);
    expect(
      result.items[0].chunkSource || bound.toChunkSource(result.items[0])
    ).toMatch(new RegExp(`^slack://${CHANNEL}/`));

    const historyUrl = fetchMock.mock.calls
      .map(([url]) => String(url))
      .find((url) => url.includes("conversations.history"));
    expect(historyUrl).toContain(`oldest=${cursor}`);
  });

  it("delta keeps paging newest-first until has_more is false", async () => {
    const older = {
      type: "message",
      user: "U3",
      text: "earlier new message",
      ts: "1710000000.000050",
    };
    fetchMock.mockImplementation(async (url) => {
      const href = String(url);
      if (href.includes("conversations.join")) return jsonResponse({ ok: true });
      if (href.includes("conversations.history")) {
        if (!href.includes("cursor=")) {
          return jsonResponse({
            ok: true,
            has_more: true,
            messages: [MESSAGE_B],
            response_metadata: { next_cursor: "page2" },
          });
        }
        return jsonResponse({
          ok: true,
          has_more: false,
          messages: [older, MESSAGE_A],
        });
      }
      return jsonResponse({ ok: true });
    });

    const bound = createSlackAdapter({
      accessToken: TOKEN,
      channelId: CHANNEL,
    });
    const result = await bound.delta("1700000000.000000");
    expect(result.items.map((item) => item.ts).sort()).toEqual(
      [older.ts, MESSAGE_A.ts, MESSAGE_B.ts].sort()
    );
    const historyCalls = fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes("conversations.history"));
    expect(historyCalls.length).toBe(2);
    expect(historyCalls[1]).toContain("cursor=page2");
  });

  it("delta fetches conversations.replies for known threads newer than the cursor", async () => {
    const parent = {
      type: "message",
      user: "U1",
      text: "old thread",
      ts: "1600000000.000001",
    };
    const reply = {
      type: "message",
      user: "U2",
      text: "new reply",
      ts: "1710000999.000001",
      thread_ts: parent.ts,
    };
    fetchMock.mockImplementation(async (url) => {
      const href = String(url);
      if (href.includes("conversations.join")) return jsonResponse({ ok: true });
      if (href.includes("conversations.history")) {
        // Slack history + oldest never returns the old parent.
        return jsonResponse({ ok: true, has_more: false, messages: [] });
      }
      if (href.includes("conversations.replies")) {
        expect(href).toContain(`ts=${parent.ts}`);
        expect(href).toContain("oldest=1700000000.000000");
        return jsonResponse({
          ok: true,
          messages: [parent, reply],
        });
      }
      return jsonResponse({ ok: true });
    });

    const bound = createSlackAdapter({
      accessToken: TOKEN,
      channelId: CHANNEL,
      config: { thread_ids: [parent.ts] },
    });
    const result = await bound.delta("1700000000.000000");
    expect(result.items).toHaveLength(1);
    expect(result.items[0].ts).toBe(parent.ts);
    expect(result.items[0].latest_reply).toBe(reply.ts);
    expect(bound.toChunkSource(result.items[0])).toBe(
      `slack://${CHANNEL}/${parent.ts}`
    );
    expect(result.cursor).toBe(reply.ts);
    const replyCalls = fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes("conversations.replies"));
    expect(replyCalls.length).toBeGreaterThan(0);
  });

  it("requests join and groups scopes for public and private channels", () => {
    expect(BOT_SCOPES).toContain("channels:join");
    expect(BOT_SCOPES).toContain("groups:read");
    expect(BOT_SCOPES).toContain("groups:history");
    expect(USER_SCOPES).toContain("groups:read");
    expect(USER_SCOPES).toContain("groups:history");
  });

  it("encrypts slack connection meta tokens at rest", async () => {
    const { SystemSettings } = require("../../../../models/systemSettings");
    const {
      saveConnectionMeta,
      getConnectionMeta,
      SESSION_LABEL,
    } = require("../../../../utils/knowledgeSources/adapters/slack");
    let saved = null;
    const update = jest
      .spyOn(SystemSettings, "_updateSettings")
      .mockImplementation(async (updates) => {
        saved = updates[SESSION_LABEL];
        return { success: true };
      });
    const get = jest
      .spyOn(SystemSettings, "get")
      .mockImplementation(async () =>
        saved ? { label: SESSION_LABEL, value: saved } : null
      );

    await saveConnectionMeta({
      user_token: "xoxp-secret",
      bot_token: "xoxb-secret",
    });
    expect(typeof saved).toBe("string");
    expect(saved).not.toContain("xoxp-secret");
    expect(saved).not.toContain("xoxb-secret");
    const meta = await getConnectionMeta();
    expect(meta.user_token).toBe("xoxp-secret");
    expect(meta.bot_token).toBe("xoxb-secret");

    update.mockRestore();
    get.mockRestore();
  });

  it("watchHint uses a 1 hour stale window", () => {
    expect(adapter.watchHint()).toEqual({ staleAfterMs: STALE_AFTER_MS });
    expect(STALE_AFTER_MS).toBe(3600000);
  });
});
