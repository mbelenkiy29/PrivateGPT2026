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

    const historyUrl = fetchMock.mock.calls
      .map(([url]) => String(url))
      .find((url) => url.includes("conversations.history"));
    expect(historyUrl).toContain(`channel=${CHANNEL}`);
    expect(historyUrl).toContain("limit=200");
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

  it("watchHint uses a 1 hour stale window", () => {
    expect(adapter.watchHint()).toEqual({ staleAfterMs: STALE_AFTER_MS });
    expect(STALE_AFTER_MS).toBe(3600000);
  });
});
