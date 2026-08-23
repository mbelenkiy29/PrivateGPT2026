const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const {
  ExternalCommunicationConnector,
} = require("../../models/externalCommunicationConnector");
const {
  ChannelWorkspaceBinding,
} = require("../../models/channelWorkspaceBinding");
const { Workspace } = require("../../models/workspace");
const { encryptToken, decryptToken } = require("../telegramBot/utils");
const { looksMasked } = require("../fileSources/credentials");
const { streamResponse, formatCitationFooter } = require("./stream");

const CONNECTOR_TYPE = "teams";
const BOT_FRAMEWORK_OPENID =
  "https://login.botframework.com/v1/.well-known/openidconfiguration";
const BOT_FRAMEWORK_TOKEN_SCOPE = "https://api.botframework.com/.default";
const ACTIVITY_TTL_MS = 10 * 60 * 1000;
const JWKS_TTL_MS = 24 * 60 * 60 * 1000;
const TOKEN_REFRESH_SKEW_MS = 60 * 1000;

const HELP_TEXT = `Ask me a question about this workspace's knowledge.

Commands:
• \`/switch\` — list workspaces
• \`/switch name\` — bind this channel to a workspace
• \`/status\` — show the bound workspace
• \`/help\` — this message

I'll reply in this thread with citations.`;

const processedActivities = new Map();
const tokenCache = new Map();
let jwksCache = { keys: null, fetchedAt: 0, jwksUri: null };

function log(text, ...args) {
  console.log(`\x1b[36m[TeamsBot]\x1b[0m ${text}`, ...args);
}

function header(headers = {}, name) {
  const needle = String(name).toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === needle) return value;
  }
  return undefined;
}

function maskSecret(secret) {
  if (!secret) return "";
  if (secret.length <= 4) return "****";
  return `${"*".repeat(Math.max(secret.length - 4, 4))}${secret.slice(-4)}`;
}

function bearerToken(headers = {}) {
  const value = header(headers, "authorization") || "";
  const match = String(value).match(/^Bearer\s+(\S+)/i);
  return match ? match[1].trim() : null;
}

function isAllowedIssuer(iss) {
  if (!iss) return false;
  if (iss === "https://api.botframework.com") return true;
  if (iss === "https://login.microsoftonline.com/botframework.com/v2.0")
    return true;
  if (/^https:\/\/sts\.windows\.net\/[0-9a-f-]+\/$/i.test(iss)) return true;
  if (
    /^https:\/\/login\.microsoftonline\.com\/[0-9a-f-]+(?:\/v2\.0)?$/i.test(iss)
  )
    return true;
  return false;
}

function isAllowedServiceUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1") {
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    }
    if (parsed.protocol !== "https:") return false;
    if (
      host === "smba.trafficmanager.net" ||
      host.endsWith(".trafficmanager.net")
    )
      return true;
    if (host === "botframework.com" || host.endsWith(".botframework.com"))
      return true;
    if (host.endsWith(".azure.net") || host.endsWith(".microsoft.com"))
      return true;
    return false;
  } catch {
    return false;
  }
}

function activitiesUrl(serviceUrl, conversationId, activityId = null) {
  const base = String(serviceUrl).replace(/\/?$/, "/");
  const conv = encodeURIComponent(conversationId);
  if (activityId)
    return `${base}v3/conversations/${conv}/activities/${encodeURIComponent(
      activityId
    )}`;
  return `${base}v3/conversations/${conv}/activities`;
}

function pruneActivities(now = Date.now()) {
  for (const [id, seenAt] of processedActivities) {
    if (now - seenAt > ACTIVITY_TTL_MS) processedActivities.delete(id);
  }
}

function alreadyProcessed(activityId, now = Date.now()) {
  if (!activityId) return false;
  pruneActivities(now);
  if (processedActivities.has(activityId)) return true;
  processedActivities.set(activityId, now);
  return false;
}

function telegramHtmlToTeamsMarkdown(html = "") {
  const links = [];
  const withPlaceholders = String(html).replace(
    /<a href="([^"]+)">([\s\S]*?)<\/a>/gi,
    (_match, href, text) => {
      links.push(`[${text}](${href})`);
      return `@@LINK${links.length - 1}@@`;
    }
  );
  return withPlaceholders
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<p>/gi, "")
    .replace(/<(?:b|strong)>([\s\S]*?)<\/(?:b|strong)>/gi, "**$1**")
    .replace(/<(?:i|em)>([\s\S]*?)<\/(?:i|em)>/gi, "_$1_")
    .replace(/<code>([\s\S]*?)<\/code>/gi, "`$1`")
    .replace(/<pre>([\s\S]*?)<\/pre>/gi, "```\n$1\n```")
    .replace(/<blockquote>([\s\S]*?)<\/blockquote>/gi, "> $1")
    .replace(/<\/?[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/@@LINK(\d+)@@/g, (_match, index) => links[Number(index)] || "")
    .trim();
}

function jwkToPem(jwk) {
  return crypto
    .createPublicKey({ key: jwk, format: "jwk" })
    .export({ type: "spki", format: "pem" });
}

async function fetchJwks() {
  const now = Date.now();
  if (jwksCache.keys && now - jwksCache.fetchedAt < JWKS_TTL_MS)
    return jwksCache.keys;

  const metaRes = await fetch(BOT_FRAMEWORK_OPENID);
  const meta = await metaRes.json().catch(() => ({}));
  const jwksUri =
    meta.jwks_uri ||
    `${BOT_FRAMEWORK_OPENID.replace(/openidconfiguration$/, "keys")}`;
  const keysRes = await fetch(jwksUri);
  const body = await keysRes.json().catch(() => ({}));
  const keys = Array.isArray(body.keys) ? body.keys : [];
  jwksCache = { keys, fetchedAt: now, jwksUri };
  return keys;
}

async function verifyBotFrameworkToken(token, appId) {
  if (!token || !appId) return false;
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded?.payload || !decoded.header) return false;
  if (!isAllowedIssuer(decoded.payload.iss)) return false;

  let keys = [];
  try {
    keys = await fetchJwks();
  } catch (error) {
    log("JWKS fetch failed:", error.message);
    return false;
  }

  const kid = decoded.header.kid;
  const candidates = kid ? keys.filter((key) => key.kid === kid) : keys;
  if (!candidates.length) return false;

  for (const jwk of candidates) {
    try {
      const pem = jwkToPem(jwk);
      jwt.verify(token, pem, {
        algorithms: ["RS256"],
        audience: String(appId),
        clockTolerance: 300,
      });
      return true;
    } catch {
      // try next matching key
    }
  }
  return false;
}

async function getConnectorAccessToken(appId, appPassword, tenantId) {
  const cacheKey = `${appId}:${tenantId || "botframework.com"}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + TOKEN_REFRESH_SKEW_MS)
    return cached.token;

  const tenant = tenantId || "botframework.com";
  const url = `https://login.microsoftonline.com/${encodeURIComponent(
    tenant
  )}/oauth2/v2.0/token`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: appId,
      client_secret: appPassword,
      scope: BOT_FRAMEWORK_TOKEN_SCOPE,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.access_token) {
    const err = new Error(
      data.error_description || "Bot Framework token failed."
    );
    err.details = data;
    throw err;
  }
  tokenCache.set(cacheKey, {
    token: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
  });
  return data.access_token;
}

async function connectorPost({
  credentials,
  serviceUrl,
  conversationId,
  method = "POST",
  activityId = null,
  body,
}) {
  if (!isAllowedServiceUrl(serviceUrl))
    throw new Error("Refusing to call an untrusted Bot Framework service URL.");
  const token = await getConnectorAccessToken(
    credentials.appId,
    credentials.appPassword,
    credentials.tenantId
  );
  const url = activitiesUrl(serviceUrl, conversationId, activityId);
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(
      data.error?.message || `Bot Framework ${method} failed`
    );
    err.status = res.status;
    err.details = data;
    throw err;
  }
  return data;
}

function createTeamsStreamBot({ credentials, activity }) {
  const serviceUrl = activity.serviceUrl;
  const conversationId = activity.conversation?.id;
  const replyToId = activity.id;

  const postText = (text, parseMode) => {
    const payload =
      parseMode === "HTML" ? telegramHtmlToTeamsMarkdown(text) : text;
    return payload || " ";
  };

  return {
    async sendChatAction() {
      try {
        await connectorPost({
          credentials,
          serviceUrl,
          conversationId,
          body: {
            type: "typing",
            from: activity.recipient,
            conversation: activity.conversation,
            replyToId,
          },
        });
      } catch {
        // typing is best-effort
      }
      return true;
    },
    async sendMessage(_chatId, text, opts = {}) {
      const data = await connectorPost({
        credentials,
        serviceUrl,
        conversationId,
        body: {
          type: "message",
          text: postText(text, opts.parse_mode),
          textFormat: "markdown",
          from: activity.recipient,
          conversation: activity.conversation,
          recipient: activity.from,
          replyToId,
        },
      });
      return { message_id: data.id || data.activityId, id: data.id };
    },
    async editMessageText(text, opts = {}) {
      const id = opts.message_id || opts.id;
      if (!id) return;
      await connectorPost({
        credentials,
        serviceUrl,
        conversationId,
        method: "PUT",
        activityId: id,
        body: {
          type: "message",
          id,
          text: postText(text, opts.parse_mode),
          textFormat: "markdown",
          conversation: activity.conversation,
        },
      });
    },
  };
}

function isPersonalConversation(activity = {}) {
  const type = String(
    activity.conversation?.conversationType || ""
  ).toLowerCase();
  if (type === "personal") return true;
  if (
    activity.conversation?.isGroup === false &&
    !activity.channelData?.teamsChannelId
  )
    return true;
  return false;
}

function mentionedBot(activity = {}) {
  if (isPersonalConversation(activity)) return true;
  const botId = activity.recipient?.id;
  const entities = Array.isArray(activity.entities) ? activity.entities : [];
  if (
    botId &&
    entities.some(
      (entity) =>
        String(entity.type).toLowerCase() === "mention" &&
        entity.mentioned?.id &&
        String(entity.mentioned.id) === String(botId)
    )
  )
    return true;
  const text = String(activity.text || "");
  if (botId && text.includes(String(botId))) return true;
  if (/<at>[\s\S]*?<\/at>/i.test(text)) return true;
  return false;
}

function stripBotMention(activityOrText = "") {
  if (typeof activityOrText === "string") {
    return activityOrText
      .replace(/<at>[\s\S]*?<\/at>/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  let text = String(activityOrText?.text || "");
  for (const entity of activityOrText.entities || []) {
    if (String(entity.type).toLowerCase() === "mention" && entity.text) {
      text = text.split(entity.text).join(" ");
    }
  }
  return text
    .replace(/<at>[\s\S]*?<\/at>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCommand(text = "") {
  const trimmed = String(text).trim();
  const match = trimmed.match(/^\/(switch|status|help)(?:\s+([\s\S]+))?$/i);
  if (!match) return { type: "chat", text: trimmed };
  return {
    type: match[1].toLowerCase(),
    arg: (match[2] || "").trim(),
  };
}

function tenantIdFrom(activity = {}) {
  return (
    activity.channelData?.tenant?.id ||
    activity.conversation?.tenantId ||
    activity.conversation?.tenantID ||
    null
  );
}

function channelExternalId(activity = {}) {
  const tenantId = tenantIdFrom(activity);
  const channelId = activity.channelData?.teamsChannelId;
  if (tenantId && channelId) return `${tenantId}:${channelId}`;
  const conversationId = activity.conversation?.id;
  if (tenantId && conversationId) return `${tenantId}:${conversationId}`;
  return conversationId || channelId || tenantId || null;
}

async function getConnector() {
  return ExternalCommunicationConnector.get(CONNECTOR_TYPE);
}

function decryptAppPassword(config = {}) {
  return decryptToken(config.app_password) || null;
}

function credentialsFromConfig(config = {}) {
  const appId = config.app_id || null;
  const appPassword = decryptAppPassword(config);
  const tenantId = config.tenant_id || null;
  if (!appId || !appPassword) return null;
  return { appId, appPassword, tenantId };
}

async function resolveWorkspace({ activity, defaultSlug } = {}) {
  const channelKey = channelExternalId(activity);
  const tenantKey = tenantIdFrom(activity);
  const channelBinding = channelKey
    ? await ChannelWorkspaceBinding.get({
        connector_type: CONNECTOR_TYPE,
        external_id: channelKey,
      })
    : null;
  const tenantBinding =
    !channelBinding && tenantKey
      ? await ChannelWorkspaceBinding.get({
          connector_type: CONNECTOR_TYPE,
          external_id: tenantKey,
        })
      : null;
  const binding = channelBinding || tenantBinding;
  if (binding?.workspaceId) {
    const bound = await Workspace.get({ id: Number(binding.workspaceId) });
    if (bound) return { workspace: bound, binding };
  }

  if (defaultSlug) {
    const fallback = await Workspace.get({ slug: String(defaultSlug) });
    if (fallback) return { workspace: fallback, binding: null };
  }

  return { workspace: null, binding: null };
}

async function bindChannel({ activity, workspace, threadSlug = null }) {
  const externalId = channelExternalId(activity);
  if (!externalId || !workspace?.id) return null;
  return ChannelWorkspaceBinding.upsert({
    connector_type: CONNECTOR_TYPE,
    external_id: externalId,
    workspaceId: workspace.id,
    threadSlug,
  });
}

async function findWorkspaceByQuery(query) {
  const q = String(query || "").trim();
  if (!q) return { workspace: null, matches: [] };
  const bySlug = await Workspace.get({ slug: q });
  if (bySlug) return { workspace: bySlug, matches: [bySlug] };

  const all = await Workspace.where();
  const lower = q.toLowerCase();
  const exact = all.find((ws) => String(ws.name).toLowerCase() === lower);
  if (exact) return { workspace: exact, matches: [exact] };
  const matches = all.filter(
    (ws) =>
      String(ws.name).toLowerCase().includes(lower) ||
      String(ws.slug).toLowerCase().includes(lower)
  );
  if (matches.length === 1) return { workspace: matches[0], matches };
  return { workspace: null, matches };
}

async function listWorkspaceLines() {
  const workspaces = await Workspace.where();
  if (!workspaces.length)
    return "No workspaces found. Create one in PrivateGPT first.";
  return [
    "Workspaces:",
    ...workspaces.map((ws) => `• ${ws.name} (\`${ws.slug}\`)`),
    "",
    "Bind this channel with `/switch workspace-name`.",
  ].join("\n");
}

async function handleSwitch({ bot, chatId, activity, arg }) {
  if (!arg) {
    await bot.sendMessage(chatId, await listWorkspaceLines());
    return;
  }
  const { workspace, matches } = await findWorkspaceByQuery(arg);
  if (workspace) {
    await bindChannel({ activity, workspace });
    await bot.sendMessage(
      chatId,
      `This channel is now bound to **${workspace.name}** (\`${workspace.slug}\`).`
    );
    return;
  }
  if (matches.length > 1) {
    await bot.sendMessage(
      chatId,
      [
        "Several workspaces match. Be more specific:",
        ...matches.map((ws) => `• ${ws.name} (\`${ws.slug}\`)`),
      ].join("\n")
    );
    return;
  }
  await bot.sendMessage(
    chatId,
    `No workspace named "${arg}". Use \`/switch\` to list workspaces.`
  );
}

async function handleStatus({ bot, chatId, activity, defaultSlug }) {
  const { workspace } = await resolveWorkspace({ activity, defaultSlug });
  if (!workspace) {
    await bot.sendMessage(
      chatId,
      "No workspace configured. Use `/switch` to pick one."
    );
    return;
  }
  await bot.sendMessage(
    chatId,
    `Workspace: **${workspace.name}** (\`${workspace.slug}\`)\nChat mode: ${
      workspace.chatMode || "chat"
    }`
  );
}

function isBotActivity(activity = {}) {
  if (!activity) return true;
  if (String(activity.from?.role || "").toLowerCase() === "bot") return true;
  if (
    activity.from?.id &&
    activity.recipient?.id &&
    String(activity.from.id) === String(activity.recipient.id)
  )
    return true;
  return false;
}

async function processTeamsMessage(activity = {}) {
  if (!activity?.type || String(activity.type).toLowerCase() !== "message")
    return { skipped: true, reason: activity.type || "not-message" };
  if (!activity.conversation?.id || !activity.serviceUrl)
    return { skipped: true, reason: "incomplete" };
  if (!isAllowedServiceUrl(activity.serviceUrl))
    return { skipped: true, reason: "service-url" };
  if (isBotActivity(activity)) return { skipped: true, reason: "bot" };
  if (!mentionedBot(activity)) return { skipped: true, reason: "no-mention" };

  const connector = await getConnector();
  if (!connector?.active) return { skipped: true, reason: "inactive" };
  const credentials = credentialsFromConfig(connector.config || {});
  if (!credentials) return { skipped: true, reason: "no-credentials" };

  const bot = createTeamsStreamBot({ credentials, activity });
  const chatId = activity.conversation.id;
  const command = parseCommand(stripBotMention(activity));
  const defaultSlug = connector.config?.default_workspace || null;

  try {
    if (command.type === "help" || (!command.text && command.type === "chat")) {
      await bot.sendMessage(chatId, HELP_TEXT);
      return { ok: true, command: command.type === "help" ? "help" : "empty" };
    }
    if (command.type === "switch") {
      await handleSwitch({ bot, chatId, activity, arg: command.arg });
      return { ok: true, command: "switch" };
    }
    if (command.type === "status") {
      await handleStatus({ bot, chatId, activity, defaultSlug });
      return { ok: true, command: "status" };
    }

    const { workspace } = await resolveWorkspace({ activity, defaultSlug });
    if (!workspace) {
      await bot.sendMessage(
        chatId,
        "No workspace configured. Use `/switch` to pick one."
      );
      return { ok: true, command: "unbound" };
    }

    const ctx = {
      bot,
      log: (text, ...args) => log(text, ...args),
    };
    await streamResponse({
      ctx,
      chatId,
      workspace,
      thread: null,
      message: command.text,
      attachments: [],
      voiceResponse: false,
      includeCitations: true,
    });
    return { ok: true, command: "chat", workspaceSlug: workspace.slug };
  } catch (error) {
    log("message error:", error.message);
    try {
      await bot.sendMessage(
        chatId,
        "Sorry, something went wrong. Please try again."
      );
    } catch {}
    return { ok: false, error: error.message };
  }
}

async function processTeamsActivity(activity = {}) {
  if (!activity || typeof activity !== "object")
    return { skipped: true, reason: "empty" };
  if (alreadyProcessed(activity.id))
    return { skipped: true, reason: "duplicate" };
  return processTeamsMessage(activity);
}

async function acceptTeamsActivity(request = {}) {
  const connector = await getConnector();
  const credentials = credentialsFromConfig(connector?.config || {});
  if (!credentials) {
    return {
      status: 401,
      body: { ok: false, error: "Teams bot is not configured." },
    };
  }

  const token = bearerToken(request.headers || {});
  const valid = await verifyBotFrameworkToken(token, credentials.appId);
  if (!valid) {
    return {
      status: 401,
      body: { ok: false, error: "Invalid Bot Framework token." },
    };
  }

  const activity = request.body || {};
  if (
    typeof activity !== "object" ||
    Array.isArray(activity) ||
    !activity.type
  ) {
    return { status: 400, body: { ok: false, error: "Invalid activity." } };
  }

  if (token) {
    const payload = jwt.decode(token);
    if (
      payload?.serviceurl &&
      activity.serviceUrl &&
      String(payload.serviceurl).replace(/\/$/, "") !==
        String(activity.serviceUrl).replace(/\/$/, "")
    ) {
      return {
        status: 401,
        body: { ok: false, error: "Token service URL mismatch." },
      };
    }
  }

  if (!connector.active) {
    return {
      status: 200,
      body: { ok: true, skipped: "inactive" },
    };
  }

  return {
    status: 200,
    body: { ok: true },
    activity,
  };
}

function publicOrigin(request) {
  const protocol =
    request?.headers?.["x-forwarded-proto"] || request?.protocol || "http";
  const host =
    request?.headers?.["x-forwarded-host"] ||
    request?.get?.("host") ||
    request?.headers?.host ||
    "localhost:3001";
  return `${protocol}://${host}`;
}

async function publicBotConfig(request) {
  const [connector, workspaces] = await Promise.all([
    getConnector(),
    Workspace.where(),
  ]);
  const secret = decryptAppPassword(connector?.config || {});
  const appId = connector?.config?.app_id || "";
  return {
    active: Boolean(connector?.active && secret && appId),
    configured: Boolean(secret && appId),
    appId,
    appPassword: maskSecret(secret),
    tenantId: connector?.config?.tenant_id || "",
    defaultWorkspace: connector?.config?.default_workspace || null,
    messagingUrl: `${publicOrigin(request)}/api/channels/teams/messages`,
    workspaces: workspaces.map((ws) => ({
      id: ws.id,
      name: ws.name,
      slug: ws.slug,
    })),
  };
}

async function saveBotConfig({
  microsoftAppId,
  microsoftAppPassword,
  tenantId,
  defaultWorkspace,
  active,
} = {}) {
  const existing = await getConnector();
  const current = existing?.config || {};
  const next = { ...current };

  if (microsoftAppId !== undefined) {
    next.app_id = String(microsoftAppId || "").trim();
  }

  if (microsoftAppPassword && !looksMasked(microsoftAppPassword)) {
    const encrypted = encryptToken(String(microsoftAppPassword).trim());
    if (!encrypted)
      return { success: false, error: "Could not encrypt app password." };
    next.app_password = encrypted;
  }

  if (tenantId !== undefined) {
    next.tenant_id = String(tenantId || "").trim() || null;
  }

  if (defaultWorkspace !== undefined) {
    if (defaultWorkspace) {
      const workspace = await Workspace.get({
        slug: String(defaultWorkspace),
      });
      if (!workspace) return { success: false, error: "Workspace not found." };
      next.default_workspace = workspace.slug;
    } else {
      next.default_workspace = null;
    }
  }

  const enable = active === undefined ? true : Boolean(active);
  if (enable && (!next.app_id || !decryptAppPassword(next))) {
    return {
      success: false,
      error:
        "Microsoft App ID and app password are required to enable the bot.",
    };
  }

  const { error } = await ExternalCommunicationConnector.upsert(
    CONNECTOR_TYPE,
    {
      ...next,
      active: enable,
    }
  );
  if (error) return { success: false, error };
  tokenCache.clear();
  return { success: true };
}

async function disableBot() {
  const existing = await getConnector();
  if (!existing) return { success: true };
  const { error } = await ExternalCommunicationConnector.upsert(
    CONNECTOR_TYPE,
    {
      ...existing.config,
      active: false,
    }
  );
  if (error) return { success: false, error };
  return { success: true };
}

function resetCaches() {
  processedActivities.clear();
  tokenCache.clear();
  jwksCache = { keys: null, fetchedAt: 0, jwksUri: null };
}

module.exports = {
  CONNECTOR_TYPE,
  HELP_TEXT,
  BOT_FRAMEWORK_OPENID,
  verifyBotFrameworkToken,
  isAllowedServiceUrl,
  isAllowedIssuer,
  telegramHtmlToTeamsMarkdown,
  stripBotMention,
  parseCommand,
  channelExternalId,
  mentionedBot,
  isPersonalConversation,
  createTeamsStreamBot,
  acceptTeamsActivity,
  processTeamsActivity,
  processTeamsMessage,
  publicBotConfig,
  saveBotConfig,
  disableBot,
  decryptAppPassword,
  formatCitationFooter,
  resetCaches,
};
