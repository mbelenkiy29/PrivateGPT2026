/* eslint-env jest */
process.env.SIG_KEY = process.env.SIG_KEY || "a".repeat(64);
process.env.SIG_SALT = process.env.SIG_SALT || "b".repeat(64);
process.env.STORAGE_DIR =
  process.env.STORAGE_DIR ||
  require("path").resolve(__dirname, "../../../storage");

const crypto = require("crypto");
const jwt = require("jsonwebtoken");

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
  streamResponse: jest.fn(
    async ({ ctx, chatId, includeCitations, workspace, message }) => {
      await ctx.bot.sendMessage(chatId, `Answer: ${message} [${workspace.slug}]`);
      if (includeCitations) {
        await ctx.bot.sendMessage(chatId, "*Sources*\n1. Employee handbook");
      }
    }
  ),
  formatCitationFooter: jest.fn((sources) =>
    sources?.length ? `*Sources*\n1. ${sources[0].title}` : null
  ),
}));

const {
  ExternalCommunicationConnector,
} = require("../../../models/externalCommunicationConnector");
const {
  ChannelWorkspaceBinding,
} = require("../../../models/channelWorkspaceBinding");
const { Workspace } = require("../../../models/workspace");
const { streamResponse } = require("../../../utils/channelChat/stream");
const { encryptToken } = require("../../../utils/telegramBot/utils");
const {
  verifyBotFrameworkToken,
  acceptTeamsActivity,
  processTeamsActivity,
  processTeamsMessage,
  stripBotMention,
  parseCommand,
  resetCaches,
  telegramHtmlToTeamsMarkdown,
  isAllowedServiceUrl,
  saveBotConfig,
  publicBotConfig,
  mentionedBot,
} = require("../../../utils/channelChat/teams");

const APP_ID = "11111111-2222-3333-4444-555555555555";
const APP_PASSWORD = "teams-app-secret";
const TENANT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const CHANNEL_ID = "19:channel@thread.tacv2";
const CONVERSATION_ID = `${CHANNEL_ID};messageid=1710000000000`;
const SERVICE_URL = "https://smba.trafficmanager.net/amer/";
const BOT_ID = `28:${APP_ID}`;
const USER_ID = "29:user-aad-id";
const WORKSPACE = {
  id: 7,
  name: "Support",
  slug: "support",
  chatMode: "query",
};

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const { publicKey: rotatedPublic, privateKey: rotatedPrivate } =
  crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const TEST_JWK = {
  ...publicKey.export({ format: "jwk" }),
  kid: "test-key",
  use: "sig",
  alg: "RS256",
};
const ROTATED_JWK = {
  ...rotatedPublic.export({ format: "jwk" }),
  kid: "rotated-key",
  use: "sig",
  alg: "RS256",
};

function signToken(payload = {}, options = {}) {
  const claims = {
    iss: "https://api.botframework.com",
    aud: APP_ID,
    serviceurl: SERVICE_URL,
    ...payload,
  };
  if (payload.serviceurl === null) delete claims.serviceurl;
  const { secret = privateKey, ...signOpts } = options;
  return jwt.sign(claims, secret, {
    algorithm: "RS256",
    keyid: "test-key",
    ...(claims.exp ? {} : { expiresIn: "1h" }),
    ...signOpts,
  });
}

function jsonResponse(body = { id: "a-reply-id" }, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function mentionActivity({
  text = "<at>PrivateAI</at> what is the refund policy?",
  id = `act-${Math.random().toString(16).slice(2)}`,
  fromId = USER_ID,
  conversationType = "channel",
  serviceUrl = SERVICE_URL,
  mention = true,
  entities,
} = {}) {
  return {
    type: "message",
    id,
    timestamp: "2026-01-15T12:00:00.000Z",
    serviceUrl,
    channelId: "msteams",
    from: { id: fromId, name: "Ada", aadObjectId: "user-oid" },
    conversation: {
      isGroup: conversationType !== "personal",
      conversationType,
      tenantId: TENANT_ID,
      id: conversationType === "personal" ? `a:${fromId}` : CONVERSATION_ID,
    },
    recipient: { id: BOT_ID, name: "PrivateAI" },
    text,
    textFormat: "plain",
    entities:
      entities !== undefined
        ? entities
        : mention
          ? [
              {
                type: "mention",
                mentioned: { id: BOT_ID, name: "PrivateAI" },
                text: "<at>PrivateAI</at>",
              },
            ]
          : [],
    channelData: {
      tenant: { id: TENANT_ID },
      teamsChannelId: conversationType === "personal" ? undefined : CHANNEL_ID,
      teamsTeamId: "19:team@thread.tacv2",
    },
  };
}

describe("Teams @PrivateAI bot", () => {
  let fetchMock;
  let connectorRow;

  beforeEach(() => {
    resetCaches();
    connectorRow = {
      type: "teams",
      active: true,
      config: {
        app_id: APP_ID,
        app_password: encryptToken(APP_PASSWORD),
        default_workspace: WORKSPACE.slug,
        tenant_id: TENANT_ID,
      },
    };

    fetchMock = jest.fn(async (url) => {
      const u = String(url);
      if (u.includes("openidconfiguration")) {
        return jsonResponse({
          jwks_uri: "https://login.botframework.com/v1/.well-known/keys",
        });
      }
      if (u.includes(".well-known/keys")) {
        return jsonResponse({ keys: [TEST_JWK] });
      }
      if (u.includes("/oauth2/v2.0/token")) {
        return jsonResponse({ access_token: "bf-token", expires_in: 3600 });
      }
      if (u.includes("/v3/conversations/")) {
        return jsonResponse({ id: `reply-${Math.random().toString(16).slice(2)}` });
      }
      return jsonResponse({});
    });
    global.fetch = fetchMock;

    ExternalCommunicationConnector.get.mockResolvedValue(connectorRow);
    ExternalCommunicationConnector.upsert.mockResolvedValue({
      connector: { type: "teams" },
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
    streamResponse.mockClear();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("verifies a Bot Framework JWT against mocked JWKS", async () => {
    const token = signToken();
    await expect(verifyBotFrameworkToken(token, APP_ID)).resolves.toBe(true);
    await expect(verifyBotFrameworkToken(token, "other-app")).resolves.toBe(
      false
    );
    await expect(
      verifyBotFrameworkToken(signToken({ iss: "https://evil.example" }), APP_ID)
    ).resolves.toBe(false);
  });

  it("rejects activities without a valid Bot Framework token", async () => {
    const activity = mentionActivity();
    const missing = await acceptTeamsActivity({
      body: activity,
      headers: {},
    });
    expect(missing.status).toBe(401);

    const bad = await acceptTeamsActivity({
      body: activity,
      headers: { Authorization: "Bearer not-a-jwt" },
    });
    expect(bad.status).toBe(401);
    expect(bad.activity).toBeUndefined();
  });

  it("accepts a mocked Bot Framework message activity", async () => {
    const activity = mentionActivity();
    const outcome = await acceptTeamsActivity({
      body: activity,
      headers: { authorization: `Bearer ${signToken()}` },
    });
    expect(outcome.status).toBe(200);
    expect(outcome.body).toEqual({ ok: true });
    expect(outcome.activity.type).toBe("message");
  });

  it("strips @mentions and requires a leading slash for commands", () => {
    expect(
      stripBotMention({
        text: "<at>PrivateAI</at> /switch support",
        entities: [
          { type: "mention", text: "<at>PrivateAI</at>", mentioned: { id: BOT_ID } },
        ],
      })
    ).toBe("/switch support");
    expect(parseCommand("/switch support")).toEqual({
      type: "switch",
      arg: "support",
    });
    expect(parseCommand("help with the refund policy")).toEqual({
      type: "chat",
      text: "help with the refund policy",
    });
    expect(parseCommand("what is the refund policy?")).toEqual({
      type: "chat",
      text: "what is the refund policy?",
    });
  });

  it("binds the Teams channel to a workspace on /switch", async () => {
    const activity = mentionActivity({
      text: "<at>PrivateAI</at> /switch support",
    });
    const result = await processTeamsMessage(activity);
    expect(result).toMatchObject({ ok: true, command: "switch" });
    expect(ChannelWorkspaceBinding.upsert).toHaveBeenCalledWith({
      connector_type: "teams",
      external_id: `${TENANT_ID}:${CHANNEL_ID}`,
      workspaceId: WORKSPACE.id,
      threadSlug: null,
    });
    expect(streamResponse).not.toHaveBeenCalled();
    const posts = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/v3/conversations/")
    );
    expect(posts.length).toBeGreaterThan(0);
    const bodies = posts.map(([, init]) => JSON.parse(init.body));
    expect(bodies.some((body) => /Support/.test(body.text))).toBe(true);
    expect(bodies.some((body) => body.replyToId === activity.id)).toBe(true);
  });

  it("streams an in-thread reply with citations from workspace knowledge", async () => {
    ChannelWorkspaceBinding.get.mockResolvedValue({
      connector_type: "teams",
      external_id: `${TENANT_ID}:${CHANNEL_ID}`,
      workspaceId: WORKSPACE.id,
    });

    const activity = mentionActivity();
    const result = await processTeamsActivity(activity);
    expect(result).toMatchObject({
      ok: true,
      command: "chat",
      workspaceSlug: "support",
    });
    expect(streamResponse).toHaveBeenCalledTimes(1);
    expect(streamResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: CONVERSATION_ID,
        workspace: WORKSPACE,
        message: "what is the refund policy?",
        includeCitations: true,
        voiceResponse: false,
      })
    );

    const posts = fetchMock.mock.calls
      .filter(([url]) => String(url).includes("/v3/conversations/"))
      .map(([, init]) => JSON.parse(init.body));
    expect(posts.some((body) => String(body.text || "").includes("Answer:"))).toBe(
      true
    );
    expect(
      posts.some((body) => String(body.text || "").includes("Employee handbook"))
    ).toBe(true);
    expect(posts.some((body) => body.replyToId === activity.id)).toBe(true);
  });

  it("uses the default workspace when the channel has no binding", async () => {
    await processTeamsMessage(mentionActivity());
    expect(streamResponse).toHaveBeenCalledWith(
      expect.objectContaining({ workspace: WORKSPACE })
    );
    expect(Workspace.get).toHaveBeenCalledWith({ slug: "support" });
  });

  it("does not fall back to an arbitrary workspace when unbound", async () => {
    ExternalCommunicationConnector.get.mockResolvedValue({
      ...connectorRow,
      config: { ...connectorRow.config, default_workspace: null },
    });
    const result = await processTeamsMessage(mentionActivity());
    expect(result).toMatchObject({ ok: true, command: "unbound" });
    expect(streamResponse).not.toHaveBeenCalled();
  });

  it("ignores the bot's own activities and channel messages without a mention", async () => {
    const self = await processTeamsMessage(
      mentionActivity({ fromId: BOT_ID })
    );
    expect(self).toEqual({ skipped: true, reason: "bot" });

    const noMention = await processTeamsMessage(
      mentionActivity({
        text: "what is the refund policy?",
        mention: false,
      })
    );
    expect(noMention).toEqual({ skipped: true, reason: "no-mention" });
    expect(streamResponse).not.toHaveBeenCalled();
  });

  it("answers 1:1 chats without requiring an @mention", async () => {
    const activity = mentionActivity({
      text: "what is the refund policy?",
      conversationType: "personal",
      mention: false,
    });
    expect(mentionedBot(activity)).toBe(true);
    const result = await processTeamsMessage(activity);
    expect(result).toMatchObject({ ok: true, command: "chat" });
    expect(streamResponse).toHaveBeenCalled();
  });

  it("converts Telegram HTML from the shared stream into Teams markdown", () => {
    expect(
      telegramHtmlToTeamsMarkdown('<b>Hello</b> <a href="https://x">doc</a>')
    ).toBe("**Hello** [doc](https://x)");
  });

  it("refuses untrusted Bot Framework service URLs", () => {
    expect(isAllowedServiceUrl("https://smba.trafficmanager.net/amer/")).toBe(
      true
    );
    expect(isAllowedServiceUrl("https://directline.botframework.com/")).toBe(
      true
    );
    expect(
      isAllowedServiceUrl("https://smba.infra.gcc.teams.microsoft.com/")
    ).toBe(true);
    expect(isAllowedServiceUrl("https://evil.example/v3/conversations")).toBe(
      false
    );
    expect(isAllowedServiceUrl("https://contoso.trafficmanager.net/")).toBe(
      false
    );
    expect(isAllowedServiceUrl("https://evil.azure.net/bot")).toBe(false);
    expect(isAllowedServiceUrl("https://attacker.microsoft.com/")).toBe(false);
  });

  it("encrypts the Microsoft app password and never returns it from public config", async () => {
    const saved = await saveBotConfig({
      microsoftAppId: APP_ID,
      microsoftAppPassword: APP_PASSWORD,
      defaultWorkspace: WORKSPACE.slug,
      active: true,
    });
    expect(saved.success).toBe(true);
    const upserted = ExternalCommunicationConnector.upsert.mock.calls[0][1];
    expect(upserted.app_id).toBe(APP_ID);
    expect(upserted.app_password).toMatch(/^enc:/);
    expect(upserted.app_password).not.toContain(APP_PASSWORD);
    expect(upserted.active).toBe(true);

    const publicConfig = await publicBotConfig({
      protocol: "https",
      headers: { host: "llm.example" },
    });
    expect(publicConfig.appPassword).not.toContain(APP_PASSWORD);
    expect(publicConfig.appPassword).toMatch(/^\*+cret$/);
    expect(JSON.stringify(publicConfig)).not.toContain(APP_PASSWORD);
    expect(publicConfig.messagingUrl).toBe(
      "https://llm.example/api/channels/teams/messages"
    );
  });

  it("rejects expired JWTs and algorithm confusion", async () => {
    const expired = signToken({
      exp: Math.floor(Date.now() / 1000) - 600,
      iat: Math.floor(Date.now() / 1000) - 1200,
    });
    await expect(verifyBotFrameworkToken(expired, APP_ID)).resolves.toBe(false);

    const hs256 = signToken(
      {},
      { algorithm: "HS256", secret: "not-an-rsa-key" }
    );
    await expect(verifyBotFrameworkToken(hs256, APP_ID)).resolves.toBe(false);

    const noneHeader = Buffer.from(
      JSON.stringify({ alg: "none", typ: "JWT", kid: "test-key" })
    ).toString("base64url");
    const nonePayload = Buffer.from(
      JSON.stringify({
        iss: "https://api.botframework.com",
        aud: APP_ID,
        serviceurl: SERVICE_URL,
      })
    ).toString("base64url");
    await expect(
      verifyBotFrameworkToken(`${noneHeader}.${nonePayload}.`, APP_ID)
    ).resolves.toBe(false);
  });

  it("fails closed when the JWT serviceurl does not match the activity", async () => {
    const activity = mentionActivity();
    const mismatch = await acceptTeamsActivity({
      body: activity,
      headers: {
        authorization: `Bearer ${signToken({
          serviceurl: "https://smba.trafficmanager.net/other/",
        })}`,
      },
    });
    expect(mismatch.status).toBe(401);
    expect(mismatch.activity).toBeUndefined();

    const missingClaim = await acceptTeamsActivity({
      body: activity,
      headers: {
        authorization: `Bearer ${signToken({ serviceurl: null })}`,
      },
    });
    expect(missingClaim.status).toBe(401);
    expect(missingClaim.activity).toBeUndefined();
  });

  it("skips duplicate activity ids", async () => {
    const activity = mentionActivity({ id: "act-duplicate" });
    const first = await processTeamsActivity(activity);
    const second = await processTeamsActivity(activity);
    expect(first).toMatchObject({ ok: true, command: "chat" });
    expect(second).toEqual({ skipped: true, reason: "duplicate" });
    expect(streamResponse).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed JWKS fetch", async () => {
    let keyCalls = 0;
    fetchMock.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("openidconfiguration")) {
        return jsonResponse({
          jwks_uri: "https://login.botframework.com/v1/.well-known/keys",
        });
      }
      if (u.includes(".well-known/keys")) {
        keyCalls += 1;
        if (keyCalls === 1) return jsonResponse({ keys: [] }, 500);
        return jsonResponse({ keys: [TEST_JWK] });
      }
      return jsonResponse({});
    });

    const token = signToken();
    await expect(verifyBotFrameworkToken(token, APP_ID)).resolves.toBe(false);
    await expect(verifyBotFrameworkToken(token, APP_ID)).resolves.toBe(true);
    expect(keyCalls).toBe(2);
  });

  it("refetches JWKS when the token kid is unknown", async () => {
    let keyCalls = 0;
    fetchMock.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("openidconfiguration")) {
        return jsonResponse({
          jwks_uri: "https://login.botframework.com/v1/.well-known/keys",
        });
      }
      if (u.includes(".well-known/keys")) {
        keyCalls += 1;
        if (keyCalls === 1) return jsonResponse({ keys: [TEST_JWK] });
        return jsonResponse({ keys: [TEST_JWK, ROTATED_JWK] });
      }
      return jsonResponse({});
    });

    const rotated = signToken(
      {},
      { secret: rotatedPrivate, keyid: "rotated-key" }
    );
    await expect(verifyBotFrameworkToken(rotated, APP_ID)).resolves.toBe(true);
    expect(keyCalls).toBe(2);
  });

  it("ignores channel messages that only mention a colleague", async () => {
    const result = await processTeamsMessage(
      mentionActivity({
        text: "<at>Ada</at> what is the refund policy?",
        mention: false,
        entities: [
          {
            type: "mention",
            mentioned: { id: USER_ID, name: "Ada" },
            text: "<at>Ada</at>",
          },
        ],
      })
    );
    expect(result).toEqual({ skipped: true, reason: "no-mention" });
    expect(streamResponse).not.toHaveBeenCalled();
  });

  it("falls back to a tenant-level workspace binding", async () => {
    ChannelWorkspaceBinding.get.mockImplementation(async ({ external_id }) => {
      if (external_id === TENANT_ID) {
        return {
          connector_type: "teams",
          external_id: TENANT_ID,
          workspaceId: WORKSPACE.id,
        };
      }
      return null;
    });
    await processTeamsMessage(mentionActivity());
    expect(ChannelWorkspaceBinding.get).toHaveBeenCalledWith({
      connector_type: "teams",
      external_id: `${TENANT_ID}:${CHANNEL_ID}`,
    });
    expect(ChannelWorkspaceBinding.get).toHaveBeenCalledWith({
      connector_type: "teams",
      external_id: TENANT_ID,
    });
    expect(streamResponse).toHaveBeenCalledWith(
      expect.objectContaining({ workspace: WORKSPACE })
    );
  });

  it("does not re-encrypt a masked app password on save", async () => {
    const existing = connectorRow.config.app_password;
    const result = await saveBotConfig({
      microsoftAppId: APP_ID,
      microsoftAppPassword: "************cret",
      defaultWorkspace: WORKSPACE.slug,
      active: true,
    });
    expect(result.success).toBe(true);
    expect(
      ExternalCommunicationConnector.upsert.mock.calls[0][1].app_password
    ).toBe(existing);
  });

  it("builds a citation footer used after persist", () => {
    const { formatCitationFooter } = jest.requireActual(
      "../../../utils/channelChat/stream"
    );
    expect(formatCitationFooter()).toBeNull();
    expect(formatCitationFooter([{ title: "Employee handbook" }])).toBe(
      "*Sources*\n1. Employee handbook"
    );
  });
});
