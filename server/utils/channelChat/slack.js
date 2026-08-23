const crypto = require("crypto");
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
const {
  getSlackConnection,
  tokenConfigFromConnection,
} = require("../knowledgeSources/adapters/slack");

const CONNECTOR_TYPE = "slack";
const SLACK_API = "https://slack.com/api";
const SIGNATURE_MAX_AGE_SEC = 60 * 5;
const EVENT_TTL_MS = 10 * 60 * 1000;
const processedEvents = new Map();

const HELP_TEXT = `Ask me a question about this workspace's knowledge.

Commands:
• \`/switch\` — list workspaces
• \`/switch name\` — bind this channel to a workspace
• \`/status\` — show the bound workspace
• \`/help\` — this message

I'll reply in this thread with citations.`;

function log(text, ...args) {
  console.log(`\x1b[35m[SlackBot]\x1b[0m ${text}`, ...args);
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

function channelExternalId(teamId, channelId) {
  if (teamId && channelId) return `${teamId}:${channelId}`;
  return channelId || teamId || null;
}

function pruneEvents(now = Date.now()) {
  for (const [id, seenAt] of processedEvents) {
    if (now - seenAt > EVENT_TTL_MS) processedEvents.delete(id);
  }
}

function alreadyProcessed(eventId, now = Date.now()) {
  if (!eventId) return false;
  pruneEvents(now);
  if (processedEvents.has(eventId)) return true;
  processedEvents.set(eventId, now);
  return false;
}

function rawBodyFromRequest(request) {
  if (typeof request.rawBody === "string" && request.rawBody.length)
    return request.rawBody;
  if (Buffer.isBuffer(request.rawBody) && request.rawBody.length)
    return request.rawBody.toString("utf8");
  return null;
}

function verifySlackSignature({
  signingSecret,
  timestamp,
  signature,
  rawBody,
  now = Date.now(),
} = {}) {
  if (!signingSecret || !timestamp || !signature || rawBody == null)
    return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(now / 1000 - ts) > SIGNATURE_MAX_AGE_SEC) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const digest = crypto
    .createHmac("sha256", signingSecret)
    .update(base)
    .digest("hex");
  const expected = `v0=${digest}`;
  const left = Buffer.from(expected);
  const right = Buffer.from(String(signature));
  if (left.length !== right.length) return false;
  try {
    return crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function telegramHtmlToMrkdwn(html = "") {
  const links = [];
  const withPlaceholders = String(html).replace(
    /<a href="([^"]+)">([\s\S]*?)<\/a>/gi,
    (_match, href, text) => {
      links.push(`<${href}|${text}>`);
      return `@@LINK${links.length - 1}@@`;
    }
  );
  return withPlaceholders
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<p>/gi, "")
    .replace(/<(?:b|strong)>([\s\S]*?)<\/(?:b|strong)>/gi, "*$1*")
    .replace(/<(?:i|em)>([\s\S]*?)<\/(?:i|em)>/gi, "_$1_")
    .replace(/<code>([\s\S]*?)<\/code>/gi, "`$1`")
    .replace(/<pre>([\s\S]*?)<\/pre>/gi, "```$1```")
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

async function slackPost(method, token, body = {}) {
  if (!token) throw new Error("Slack is not connected.");
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    const err = new Error(data.error || `Slack ${method} failed`);
    err.slackError = data.error;
    throw err;
  }
  return data;
}

function createSlackStreamBot({ token, channel, threadTs }) {
  const postText = (text, parseMode) => {
    const payload = parseMode === "HTML" ? telegramHtmlToMrkdwn(text) : text;
    return payload || " ";
  };

  return {
    async sendChatAction() {
      return true;
    },
    async sendMessage(_chatId, text, opts = {}) {
      const data = await slackPost("chat.postMessage", token, {
        channel,
        text: postText(text, opts.parse_mode),
        thread_ts: threadTs,
        mrkdwn: true,
        unfurl_links: false,
        unfurl_media: false,
      });
      return { message_id: data.ts, ts: data.ts };
    },
    async editMessageText(text, opts = {}) {
      const ts = opts.message_id || opts.ts;
      if (!ts) return;
      await slackPost("chat.update", token, {
        channel,
        ts,
        text: postText(text, opts.parse_mode),
        mrkdwn: true,
      });
    },
  };
}

function stripBotMention(text = "") {
  return String(text)
    .replace(/<@[A-Z0-9]+(?:\|[^>]+)?>/gi, "")
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

async function getConnector() {
  return ExternalCommunicationConnector.get(CONNECTOR_TYPE);
}

function decryptSigningSecret(config = {}) {
  return decryptToken(config.signing_secret) || null;
}

async function getBotToken() {
  const connection = await getSlackConnection();
  const tokenConfig = await tokenConfigFromConnection(connection);
  return tokenConfig?.bot_token || tokenConfig?.access_token || null;
}

async function connectedTeamId(connector = null) {
  const rec = connector || (await getConnector());
  if (rec?.config?.team_id) return String(rec.config.team_id);
  const connection = await getSlackConnection();
  if (connection?.account_email) return String(connection.account_email);
  const tokenConfig = await tokenConfigFromConnection(connection);
  if (tokenConfig?.team_id) return String(tokenConfig.team_id);
  return null;
}

function teamMatches(expectedTeamId, incomingTeamId) {
  if (!expectedTeamId || !incomingTeamId) return false;
  return String(expectedTeamId) === String(incomingTeamId);
}

async function resolveWorkspace({ teamId, channelId, defaultSlug } = {}) {
  const channelKey = channelExternalId(teamId, channelId);
  const teamKey = teamId || null;
  const channelBinding = channelKey
    ? await ChannelWorkspaceBinding.get({
        connector_type: CONNECTOR_TYPE,
        external_id: channelKey,
      })
    : null;
  const teamBinding =
    !channelBinding && teamKey
      ? await ChannelWorkspaceBinding.get({
          connector_type: CONNECTOR_TYPE,
          external_id: teamKey,
        })
      : null;
  const binding = channelBinding || teamBinding;
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

async function bindChannel({
  teamId,
  channelId,
  workspace,
  threadSlug = null,
}) {
  const externalId = channelExternalId(teamId, channelId);
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

async function handleSwitch({ bot, chatId, teamId, channelId, arg }) {
  if (!arg) {
    await bot.sendMessage(chatId, await listWorkspaceLines());
    return;
  }
  const { workspace, matches } = await findWorkspaceByQuery(arg);
  if (workspace) {
    await bindChannel({ teamId, channelId, workspace });
    await bot.sendMessage(
      chatId,
      `This channel is now bound to *${workspace.name}* (\`${workspace.slug}\`).`
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

async function handleStatus({ bot, chatId, teamId, channelId, defaultSlug }) {
  const { workspace } = await resolveWorkspace({
    teamId,
    channelId,
    defaultSlug,
  });
  if (!workspace) {
    await bot.sendMessage(
      chatId,
      "No workspace configured. Use `/switch` to pick one."
    );
    return;
  }
  await bot.sendMessage(
    chatId,
    `Workspace: *${workspace.name}* (\`${workspace.slug}\`)\nChat mode: ${workspace.chatMode || "chat"}`
  );
}

function isBotEvent(event = {}, botUserId = null) {
  if (!event) return true;
  if (event.bot_id) return true;
  if (event.subtype === "bot_message") return true;
  if (botUserId && event.user && String(event.user) === String(botUserId))
    return true;
  return false;
}

async function processAppMention(event = {}, envelope = {}) {
  const teamId = envelope.team_id || event.team || null;
  const channelId = event.channel;
  const threadTs = event.thread_ts || event.ts;
  if (!channelId || !event.ts) return { skipped: true, reason: "incomplete" };

  const connector = await getConnector();
  if (!connector?.active) return { skipped: true, reason: "inactive" };

  const token = await getBotToken();
  if (!token) return { skipped: true, reason: "no-token" };

  const expectedTeam = await connectedTeamId(connector);
  if (!teamMatches(expectedTeam, teamId))
    return { skipped: true, reason: "team-mismatch" };

  if (isBotEvent(event, connector.config?.bot_user_id))
    return { skipped: true, reason: "bot" };

  const bot = createSlackStreamBot({ token, channel: channelId, threadTs });
  const chatId = channelId;
  const command = parseCommand(stripBotMention(event.text || ""));
  const defaultSlug = connector.config?.default_workspace || null;

  try {
    if (command.type === "help" || (!command.text && command.type === "chat")) {
      await bot.sendMessage(chatId, HELP_TEXT);
      return { ok: true, command: command.type === "help" ? "help" : "empty" };
    }
    if (command.type === "switch") {
      await handleSwitch({
        bot,
        chatId,
        teamId,
        channelId,
        arg: command.arg,
      });
      return { ok: true, command: "switch" };
    }
    if (command.type === "status") {
      await handleStatus({
        bot,
        chatId,
        teamId,
        channelId,
        defaultSlug,
      });
      return { ok: true, command: "status" };
    }

    const { workspace } = await resolveWorkspace({
      teamId,
      channelId,
      defaultSlug,
    });
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
    log("app_mention error:", error.message);
    try {
      await bot.sendMessage(
        chatId,
        "Sorry, something went wrong. Please try again."
      );
    } catch {}
    return { ok: false, error: error.message };
  }
}

async function processSlackCallback(body = {}) {
  const event = body.event || {};
  if (body.type !== "event_callback") return { skipped: true };
  if (alreadyProcessed(body.event_id))
    return { skipped: true, reason: "duplicate" };
  if (event.type !== "app_mention")
    return { skipped: true, reason: event.type || "unknown" };
  return processAppMention(event, body);
}

async function acceptSlackEvent(request = {}, { now = Date.now() } = {}) {
  const body = request.body || {};
  const connector = await getConnector();
  const signingSecret = decryptSigningSecret(connector?.config || {});
  if (!signingSecret) {
    return {
      status: 401,
      body: { ok: false, error: "Slack bot is not configured." },
    };
  }

  const rawBody = rawBodyFromRequest(request);
  const timestamp = header(request.headers || {}, "x-slack-request-timestamp");
  const signature = header(request.headers || {}, "x-slack-signature");
  const valid = verifySlackSignature({
    signingSecret,
    timestamp,
    signature,
    rawBody,
    now,
  });
  if (!valid) {
    return {
      status: 401,
      body: { ok: false, error: "Invalid Slack signature." },
    };
  }

  if (body.type === "url_verification") {
    return { status: 200, body: { challenge: body.challenge } };
  }

  if (!connector.active) {
    return {
      status: 200,
      body: { ok: true, skipped: "inactive" },
    };
  }

  if (body.type === "event_callback") {
    const expectedTeam = await connectedTeamId(connector);
    if (!teamMatches(expectedTeam, body.team_id)) {
      return {
        status: 200,
        body: { ok: true, skipped: "team-mismatch" },
      };
    }
  }

  return {
    status: 200,
    body: { ok: true },
    event: body,
  };
}

async function authTest(token) {
  if (!token) return null;
  try {
    return await slackPost("auth.test", token, {});
  } catch (error) {
    log("auth.test failed:", error.message);
    return null;
  }
}

async function publicBotConfig(request) {
  const [connector, connection, workspaces] = await Promise.all([
    getConnector(),
    getSlackConnection(),
    Workspace.where(),
  ]);
  const tokenConfig = await tokenConfigFromConnection(connection);
  const protocol =
    request?.headers?.["x-forwarded-proto"] || request?.protocol || "http";
  const host =
    request?.headers?.["x-forwarded-host"] ||
    request?.get?.("host") ||
    request?.headers?.host ||
    "localhost:3001";
  const secret = decryptSigningSecret(connector?.config || {});
  return {
    active: Boolean(connector?.active && secret),
    configured: Boolean(secret),
    signingSecret: maskSecret(secret),
    defaultWorkspace: connector?.config?.default_workspace || null,
    botUserId: connector?.config?.bot_user_id || null,
    slackConnected: Boolean(connection && tokenConfig?.access_token),
    team: connection
      ? { id: connection.account_email, name: connection.account_name }
      : tokenConfig
        ? { id: tokenConfig.team_id, name: tokenConfig.team_name }
        : null,
    eventsUrl: `${protocol}://${host}/api/channels/slack/events`,
    workspaces: workspaces.map((ws) => ({
      id: ws.id,
      name: ws.name,
      slug: ws.slug,
    })),
  };
}

async function saveBotConfig({ signingSecret, defaultWorkspace, active } = {}) {
  const existing = await getConnector();
  const current = existing?.config || {};
  const next = { ...current };

  if (signingSecret && !looksMasked(signingSecret)) {
    const encrypted = encryptToken(String(signingSecret).trim());
    if (!encrypted)
      return { success: false, error: "Could not encrypt signing secret." };
    next.signing_secret = encrypted;
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

  const token = await getBotToken();
  if (token) {
    const identity = await authTest(token);
    if (identity?.user_id) next.bot_user_id = identity.user_id;
    if (identity?.team_id) next.team_id = identity.team_id;
  }

  const enable = active === undefined ? true : Boolean(active);
  if (enable && !decryptSigningSecret(next)) {
    return {
      success: false,
      error: "A Slack signing secret is required to enable the bot.",
    };
  }
  if (enable && !token) {
    return {
      success: false,
      error:
        "Connect Slack under Settings → Knowledge sources before enabling the bot.",
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

module.exports = {
  CONNECTOR_TYPE,
  HELP_TEXT,
  verifySlackSignature,
  telegramHtmlToMrkdwn,
  stripBotMention,
  parseCommand,
  channelExternalId,
  createSlackStreamBot,
  acceptSlackEvent,
  processSlackCallback,
  processAppMention,
  alreadyProcessed,
  publicBotConfig,
  saveBotConfig,
  disableBot,
  getBotToken,
  decryptSigningSecret,
  formatCitationFooter,
  resetProcessedEvents: () => processedEvents.clear(),
};
