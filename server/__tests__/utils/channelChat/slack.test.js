/* eslint-env jest */
process.env.SIG_KEY = process.env.SIG_KEY || "a".repeat(64);
process.env.SIG_SALT = process.env.SIG_SALT || "b".repeat(64);

const crypto = require("crypto");

jest.mock("../../../models/externalCommunicationConnector", () => ({
  ExternalCommunicationConnector: {
    get: jest.fn(),
    upsert: jest.fn(),
  },
}));
jest.mock("../../../models/channelWorkspaceBinding", () => ({
  ChannelWorkspaceBinding: {
    get: jest.fn(),
    upsert: jest.fn(),
  },
}));
jest.mock("../../../models/workspace", () => ({
  Workspace: {
    get: jest.fn(),
    where: jest.fn(),
  },
}));
jest.mock("../../../utils/channelChat/stream", () => ({
  streamResponse: jest.fn(async ({ ctx, chatId, includeCitations, workspace, message }) => {
    await ctx.bot.sendMessage(chatId, `Answer: ${message} [${workspace.slug}]`);
    if (includeCitations) {
      await ctx.bot.sendMessage(chatId, "*Sources*\n1. Employee handbook");
    }
  }),
  formatCitationFooter: jest.fn((sources) =>
    sources?.length ? `*Sources*\n1. ${sources[0].title}` : null
  ),
}));
jest.mock("../../../utils/knowledgeSources/adapters/slack", () => ({
  getSlackConnection: jest.fn(),
  tokenConfigFromConnection: jest.fn(),
}));

const {
  ExternalCommunicationConnector,
} = require("../../../models/externalCommunicationConnector");
const {
  ChannelWorkspaceBinding,
} = require("../../../models/channelWorkspaceBinding");
const { Workspace } = require("../../../models/workspace");
const { streamResponse } = require("../../../utils/channelChat/stream");
const {
  getSlackConnection,
  tokenConfigFromConnection,
} = require("../../../utils/knowledgeSources/adapters/slack");
const { encryptToken } = require("../../../utils/telegramBot/utils");
const {
  verifySlackSignature,
  acceptSlackEvent,
  processSlackCallback,
  processAppMention,
  stripBotMention,
  parseCommand,
  resetProcessedEvents,
  telegramHtmlToMrkdwn,
  publicBotConfig,
} = require("../../../utils/channelChat/slack");

const SIGNING_SECRET = "slack-signing-secret";
const BOT_TOKEN = "xoxb-test-token";
const TEAM_ID = "T123";
const CHANNEL_ID = "C456";
const BOT_USER = "U999BOT";
const WORKSPACE = {
  id: 7,
  name: "Support",
  slug: "support",
  chatMode: "query",
};

function signBody(rawBody, timestamp, secret = SIGNING_SECRET) {
  const digest = crypto
    .createHmac("sha256", secret)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest("hex");
  return `v0=${digest}`;
}

function mentionPayload({
  text = `<@${BOT_USER}> what is the refund policy?`,
  eventId = `Ev${Math.random().toString(16).slice(2)}`,
  user = "U111",
  threadTs,
  botId,
} = {}) {
  return {
    type: "event_callback",
    team_id: TEAM_ID,
    event_id: eventId,
    event: {
      type: "app_mention",
      user,
      text,
      ts: "1710000000.000100",
      thread_ts: threadTs,
      channel: CHANNEL_ID,
      bot_id: botId,
    },
  };
}

function jsonResponse(body = { ok: true, ts: "1710000000.000200" }) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  };
}

describe("Slack @PrivateAI bot", () => {
  let fetchMock;

  beforeEach(() => {
    resetProcessedEvents();
    fetchMock = jest.fn(async () => jsonResponse());
    global.fetch = fetchMock;

    ExternalCommunicationConnector.get.mockResolvedValue({
      type: "slack",
      active: true,
      config: {
        signing_secret: encryptToken(SIGNING_SECRET),
        default_workspace: WORKSPACE.slug,
        bot_user_id: BOT_USER,
        team_id: TEAM_ID,
      },
    });
    ExternalCommunicationConnector.upsert.mockResolvedValue({
      connector: { type: "slack" },
      error: null,
    });
    ChannelWorkspaceBinding.get.mockResolvedValue(null);
    ChannelWorkspaceBinding.upsert.mockImplementation(async (row) => row);
    Workspace.get.mockImplementation(async (clause) => {
      if (clause?.slug === WORKSPACE.slug || clause?.id === WORKSPACE.id)
        return WORKSPACE;
      return null;
    });
    Workspace.where.mockResolvedValue([WORKSPACE]);
    getSlackConnection.mockResolvedValue({
      account_email: TEAM_ID,
      account_name: "Acme",
    });
    tokenConfigFromConnection.mockResolvedValue({
      access_token: BOT_TOKEN,
      bot_token: BOT_TOKEN,
      team_id: TEAM_ID,
      team_name: "Acme",
    });
    streamResponse.mockClear();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("verifies Slack request signatures", () => {
    const rawBody = '{"type":"url_verification","challenge":"abc"}';
    const timestamp = String(Math.floor(Date.now() / 1000));
    expect(
      verifySlackSignature({
        signingSecret: SIGNING_SECRET,
        timestamp,
        signature: signBody(rawBody, timestamp),
        rawBody,
      })
    ).toBe(true);
    expect(
      verifySlackSignature({
        signingSecret: SIGNING_SECRET,
        timestamp,
        signature: "v0=deadbeef",
        rawBody,
      })
    ).toBe(false);
  });

  it("returns the url_verification challenge from a fake Events payload", async () => {
    const rawBody = JSON.stringify({
      type: "url_verification",
      challenge: "challenge-token",
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const outcome = await acceptSlackEvent({
      rawBody,
      body: JSON.parse(rawBody),
      headers: {
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": signBody(rawBody, timestamp),
      },
    });
    expect(outcome.status).toBe(200);
    expect(outcome.body).toEqual({ challenge: "challenge-token" });
    expect(outcome.event).toBeUndefined();
  });

  it("rejects Events payloads with an invalid signing secret", async () => {
    const rawBody = JSON.stringify(mentionPayload());
    const timestamp = String(Math.floor(Date.now() / 1000));
    const outcome = await acceptSlackEvent({
      rawBody,
      body: JSON.parse(rawBody),
      headers: {
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": signBody(rawBody, timestamp, "wrong-secret"),
      },
    });
    expect(outcome.status).toBe(401);
    expect(outcome.body.error).toMatch(/signature/i);
  });

  it("accepts a signed app_mention Events payload", async () => {
    const payload = mentionPayload();
    const rawBody = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const outcome = await acceptSlackEvent({
      rawBody,
      body: payload,
      headers: {
        "X-Slack-Request-Timestamp": timestamp,
        "X-Slack-Signature": signBody(rawBody, timestamp),
      },
    });
    expect(outcome.status).toBe(200);
    expect(outcome.body).toEqual({ ok: true });
    expect(outcome.event.event.type).toBe("app_mention");
  });

  it("strips mentions and parses /switch like Telegram", () => {
    expect(stripBotMention(`<@${BOT_USER}> /switch support`)).toBe(
      "/switch support"
    );
    expect(parseCommand("/switch support")).toEqual({
      type: "switch",
      arg: "support",
    });
    expect(parseCommand("what is the refund policy?")).toEqual({
      type: "chat",
      text: "what is the refund policy?",
    });
    expect(parseCommand("help with the refund policy")).toEqual({
      type: "chat",
      text: "help with the refund policy",
    });
    expect(parseCommand("status of invoice 123")).toEqual({
      type: "chat",
      text: "status of invoice 123",
    });
    expect(parseCommand("/help")).toEqual({ type: "help", arg: "" });
  });

  it("sends natural-language help questions through RAG, not HELP_TEXT", async () => {
    await processAppMention(
      mentionPayload({
        text: `<@${BOT_USER}> help with the refund policy`,
      }).event,
      { team_id: TEAM_ID }
    );
    expect(streamResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "help with the refund policy",
        includeCitations: true,
      })
    );
    const posted = fetchMock.mock.calls.map(([, init]) =>
      JSON.parse(init.body)
    );
    expect(posted.some((body) => /Commands:/.test(body.text))).toBe(false);
  });

  it("binds the Slack channel to a workspace on /switch", async () => {
    const result = await processAppMention(
      mentionPayload({ text: `<@${BOT_USER}> /switch support` }).event,
      { team_id: TEAM_ID }
    );
    expect(result).toMatchObject({ ok: true, command: "switch" });
    expect(ChannelWorkspaceBinding.upsert).toHaveBeenCalledWith({
      connector_type: "slack",
      external_id: `${TEAM_ID}:${CHANNEL_ID}`,
      workspaceId: WORKSPACE.id,
      threadSlug: null,
    });
    expect(streamResponse).not.toHaveBeenCalled();
    const posted = fetchMock.mock.calls.map(([, init]) =>
      JSON.parse(init.body)
    );
    expect(posted.some((body) => /Support/.test(body.text))).toBe(true);
    expect(posted[0].thread_ts).toBe("1710000000.000100");
  });

  it("streams an in-thread reply with citations from workspace knowledge", async () => {
    ChannelWorkspaceBinding.get.mockResolvedValue({
      connector_type: "slack",
      external_id: `${TEAM_ID}:${CHANNEL_ID}`,
      workspaceId: WORKSPACE.id,
    });

    const payload = mentionPayload();
    const result = await processSlackCallback(payload);
    expect(result).toMatchObject({
      ok: true,
      command: "chat",
      workspaceSlug: "support",
    });
    expect(streamResponse).toHaveBeenCalledTimes(1);
    expect(streamResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: CHANNEL_ID,
        workspace: WORKSPACE,
        message: "what is the refund policy?",
        includeCitations: true,
        voiceResponse: false,
      })
    );

    const posts = fetchMock.mock.calls
      .filter(([url]) => String(url).includes("chat.postMessage"))
      .map(([, init]) => JSON.parse(init.body));
    expect(posts[0].thread_ts).toBe("1710000000.000100");
    expect(posts[0].channel).toBe(CHANNEL_ID);
    expect(posts.some((body) => body.text.includes("Answer:"))).toBe(true);
    expect(posts.some((body) => body.text.includes("Employee handbook"))).toBe(
      true
    );
  });

  it("uses the default workspace when the channel has no binding", async () => {
    await processAppMention(mentionPayload().event, { team_id: TEAM_ID });
    expect(streamResponse).toHaveBeenCalledWith(
      expect.objectContaining({ workspace: WORKSPACE })
    );
    expect(Workspace.get).toHaveBeenCalledWith({ slug: "support" });
  });

  it("ignores the bot's own app_mention events", async () => {
    const result = await processAppMention(
      mentionPayload({ user: BOT_USER }).event,
      { team_id: TEAM_ID }
    );
    expect(result).toEqual({ skipped: true, reason: "bot" });
    expect(streamResponse).not.toHaveBeenCalled();
  });

  it("converts Telegram HTML from the shared stream into Slack mrkdwn", () => {
    expect(
      telegramHtmlToMrkdwn('<b>Hello</b> <a href="https://x">doc</a>')
    ).toBe("*Hello* <https://x|doc>");
  });

  it("rejects Events payloads when rawBody is missing even if JSON.stringify is signed", async () => {
    const payload = mentionPayload();
    const reconstructed = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const outcome = await acceptSlackEvent({
      body: payload,
      headers: {
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": signBody(reconstructed, timestamp),
      },
    });
    expect(outcome.status).toBe(401);
    expect(outcome.event).toBeUndefined();
  });

  it("rejects replayed Events with a stale timestamp", async () => {
    const payload = mentionPayload();
    const rawBody = JSON.stringify(payload);
    const now = Date.now();
    const timestamp = String(Math.floor(now / 1000) - 301);
    expect(
      verifySlackSignature({
        signingSecret: SIGNING_SECRET,
        timestamp,
        signature: signBody(rawBody, timestamp),
        rawBody,
        now,
      })
    ).toBe(false);
    const outcome = await acceptSlackEvent(
      {
        rawBody,
        body: payload,
        headers: {
          "x-slack-request-timestamp": timestamp,
          "x-slack-signature": signBody(rawBody, timestamp),
        },
      },
      { now }
    );
    expect(outcome.status).toBe(401);
  });

  it("rejects Events payloads missing Slack signature headers", async () => {
    const payload = mentionPayload();
    const rawBody = JSON.stringify(payload);
    const outcome = await acceptSlackEvent({
      rawBody,
      body: payload,
      headers: {},
    });
    expect(outcome.status).toBe(401);
  });

  it("drops signed app_mention events from a different Slack team", async () => {
    const payload = mentionPayload();
    payload.team_id = "TOTHER";
    const rawBody = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const outcome = await acceptSlackEvent({
      rawBody,
      body: payload,
      headers: {
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": signBody(rawBody, timestamp),
      },
    });
    expect(outcome.status).toBe(200);
    expect(outcome.body).toEqual({ ok: true, skipped: "team-mismatch" });
    expect(outcome.event).toBeUndefined();

    const processed = await processAppMention(payload.event, {
      team_id: "TOTHER",
    });
    expect(processed).toEqual({ skipped: true, reason: "team-mismatch" });
    expect(streamResponse).not.toHaveBeenCalled();
  });

  it("does not answer from an arbitrary workspace when none is bound", async () => {
    ExternalCommunicationConnector.get.mockResolvedValue({
      type: "slack",
      active: true,
      config: {
        signing_secret: encryptToken(SIGNING_SECRET),
        default_workspace: null,
        bot_user_id: BOT_USER,
        team_id: TEAM_ID,
      },
    });
    Workspace.where.mockResolvedValue([
      WORKSPACE,
      { id: 8, name: "Other", slug: "other" },
    ]);

    const result = await processAppMention(mentionPayload().event, {
      team_id: TEAM_ID,
    });
    expect(result).toMatchObject({ ok: true, command: "unbound" });
    expect(streamResponse).not.toHaveBeenCalled();
    const posted = fetchMock.mock.calls.map(([, init]) =>
      JSON.parse(init.body)
    );
    expect(posted.some((body) => /\/switch/.test(body.text))).toBe(true);
  });

  it("skips duplicate Slack event_ids", async () => {
    ChannelWorkspaceBinding.get.mockResolvedValue({
      connector_type: "slack",
      external_id: `${TEAM_ID}:${CHANNEL_ID}`,
      workspaceId: WORKSPACE.id,
    });
    const payload = mentionPayload({ eventId: "EvDuplicate" });
    await processSlackCallback(payload);
    expect(streamResponse).toHaveBeenCalledTimes(1);
    streamResponse.mockClear();
    const again = await processSlackCallback(payload);
    expect(again).toEqual({ skipped: true, reason: "duplicate" });
    expect(streamResponse).not.toHaveBeenCalled();
  });

  it("does not leak Slack tokens or the signing secret in public bot config", async () => {
    const config = await publicBotConfig({
      protocol: "https",
      headers: { host: "example.test" },
    });
    const serialized = JSON.stringify(config);
    expect(serialized).not.toContain(BOT_TOKEN);
    expect(serialized).not.toContain("xoxb-");
    expect(serialized).not.toContain("access_token");
    expect(serialized).not.toContain(SIGNING_SECRET);
    expect(config.slackConnected).toBe(true);
    expect(config.signingSecret).toMatch(/^\*+[a-z0-9]{4}$/i);
    expect(config.signingSecret).not.toBe(SIGNING_SECRET);
  });
});
