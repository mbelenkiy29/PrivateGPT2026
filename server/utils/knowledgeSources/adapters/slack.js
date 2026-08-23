const { registerAdapter } = require("../adapter");
const { DocumentSyncQueue } = require("../../../models/documentSyncQueue");
const { SystemSettings } = require("../../../models/systemSettings");
const { ConnectedFileSource } = require("../../../models/connectedFileSource");
const { looksMasked } = require("../../fileSources/credentials");
const { safeJsonParse } = require("../../http");

const SLACK_AUTHORIZE = "https://slack.com/oauth/v2/authorize";
const SLACK_OAUTH_ACCESS = "https://slack.com/api/oauth.v2.access";
const SLACK_API = "https://slack.com/api";
const BOT_SCOPES =
  "app_mentions:read,channels:history,channels:read,channels:join,chat:write,chat:write.public,files:read,groups:read,groups:history";
const USER_SCOPES =
  "channels:history,channels:read,files:read,groups:read,groups:history";
const SCOPES = BOT_SCOPES;
const PAGE_SIZE = 200;
const MAX_DELTA_PAGES = 10;
const MAX_WATCHED_THREADS = 500;
const CONFIG_LABEL = "slack_oauth_config";
const SESSION_LABEL = "slack_connection_meta";
const PROVIDER = "slack";
const STALE_AFTER_MS = 3_600_000;
const MIME_MARKDOWN = "text/markdown";
const JOIN_IGNORABLE = new Set([
  "already_in_channel",
  "method_not_supported_for_channel_type",
  "channel_not_found",
  "restricted_action",
  "missing_scope",
]);

function envFallback() {
  return {
    clientId: process.env.SLACK_CLIENT_ID || "",
    clientSecret: process.env.SLACK_CLIENT_SECRET || "",
  };
}

async function getSlackOAuthConfig() {
  const stored = safeJsonParse(
    (await SystemSettings.get({ label: CONFIG_LABEL }))?.value,
    {}
  );
  const env = envFallback();
  return {
    clientId: stored?.clientId || env.clientId || "",
    clientSecret: stored?.clientSecret || env.clientSecret || "",
  };
}

function publicSlackOAuthConfig(config) {
  const clientSecret = config.clientSecret || "";
  return {
    clientId: config.clientId || "",
    clientSecret: maskSecret(clientSecret),
    configured: Boolean(config.clientId && config.clientSecret),
  };
}

function maskSecret(secret) {
  if (!secret) return "";
  if (secret.length <= 4) return "****";
  return `${"*".repeat(Math.max(secret.length - 4, 4))}${secret.slice(-4)}`;
}

async function saveSlackOAuthConfig(incoming = {}) {
  const existing = await getSlackOAuthConfig();
  const next = {
    clientId: incoming.clientId ?? existing.clientId,
    clientSecret: looksMasked(incoming.clientSecret)
      ? existing.clientSecret
      : incoming.clientSecret ?? existing.clientSecret,
  };
  await SystemSettings._updateSettings({
    [CONFIG_LABEL]: JSON.stringify(next),
  });
  return next;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Call a Slack Web API method. Retries once on HTTP 429.
 * @param {string} method
 * @param {string} token
 * @param {Record<string, string|number|boolean|undefined>} params
 */
async function slackApi(method, token, params = {}) {
  if (!token)
    throw new Error("Slack is not connected. Reconnect the workspace.");

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    query.set(key, String(value));
  }
  const url = `${SLACK_API}/${method}${query.toString() ? `?${query}` : ""}`;

  let res;
  for (let attempt = 0; attempt < 2; attempt++) {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status !== 429) break;
    const retryAfter = Number(res.headers.get("Retry-After") || 1);
    await sleep(Math.max(retryAfter, 1) * 1000);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    const err = new Error(
      data.error || `Slack ${method} failed (${res.status})`
    );
    err.status = res.status;
    err.slackError = data.error;
    throw err;
  }
  return data;
}

function decryptSourceConfig(source) {
  if (!source) return {};
  if (source.config && typeof source.config === "object") return source.config;
  if (!source.encrypted_config) return {};
  const { KnowledgeSource } = require("../../../models/knowledgeSource");
  const config = KnowledgeSource.decryptConfig(source);
  return config && typeof config === "object" ? config : {};
}

function tokenFromConfig(config = {}) {
  return (
    config.bot_token ||
    config.access_token ||
    config.user_token ||
    config.token ||
    null
  );
}

function resolveContext(defaults = {}, opts = {}, item = null) {
  const source = opts.source || item?.source || defaults.source || null;
  const config = {
    ...decryptSourceConfig(source),
    ...(defaults.config || {}),
    ...(opts.config || {}),
  };
  const botToken =
    opts.botToken ||
    defaults.botToken ||
    config.bot_token ||
    (typeof config.access_token === "string" &&
    config.access_token.startsWith("xoxb-")
      ? config.access_token
      : null);
  const userToken =
    opts.userToken ||
    defaults.userToken ||
    config.user_token ||
    (typeof config.access_token === "string" &&
    config.access_token.startsWith("xoxp-")
      ? config.access_token
      : null);
  const accessToken =
    opts.accessToken ||
    defaults.accessToken ||
    tokenFromConfig(config) ||
    item?.accessToken ||
    null;
  const channelId =
    opts.folderId ||
    opts.remote_id ||
    opts.channelId ||
    defaults.channelId ||
    defaults.folderId ||
    source?.remote_id ||
    item?.channelId ||
    item?.channel ||
    null;
  return { accessToken, botToken, userToken, channelId, config, source };
}

async function joinChannel(token, channelId) {
  if (!token || !channelId) return false;
  try {
    await slackApi("conversations.join", token, { channel: channelId });
    return true;
  } catch (e) {
    if (JOIN_IGNORABLE.has(e.slackError)) return false;
    throw e;
  }
}

async function historyWithJoin(ctx, { cursor, oldest } = {}) {
  if (!ctx.channelId)
    throw new Error("Slack adapter requires a channel id (remote_id)");
  const joinToken = ctx.botToken || ctx.accessToken;
  await joinChannel(joinToken, ctx.channelId);

  const params = {
    channel: ctx.channelId,
    limit: PAGE_SIZE,
    cursor: cursor || undefined,
    oldest: oldest || undefined,
  };
  try {
    return await slackApi("conversations.history", ctx.accessToken, params);
  } catch (e) {
    const fallback = ctx.userToken;
    if (
      e.slackError === "not_in_channel" &&
      fallback &&
      fallback !== ctx.accessToken
    ) {
      return slackApi("conversations.history", fallback, params);
    }
    throw e;
  }
}

function formatTs(ts) {
  const ms = Number(ts) * 1000;
  if (!Number.isFinite(ms)) return String(ts || "");
  return new Date(ms).toISOString();
}

function newestTs(messages = []) {
  let max = null;
  for (const message of messages) {
    const ts = typeof message === "string" ? message : message?.ts;
    if (!ts) continue;
    if (!max || Number(ts) > Number(max)) max = ts;
  }
  return max;
}

function messagesToItems(messages = [], channelId) {
  return (messages || []).map((message) => {
    const ts = message.ts;
    const threadTs = message.thread_ts || message.ts;
    return {
      id: ts,
      channelId,
      channel: channelId,
      ts,
      thread_ts: threadTs,
      text: message.text || "",
      user: message.user || message.username || "unknown",
      files: message.files || [],
      reply_count: message.reply_count || 0,
      latest_reply: message.latest_reply || null,
      name: `${channelId}-${ts}`,
    };
  });
}

function messageToMarkdown(message) {
  const who = message.username || message.user || "unknown";
  const when = formatTs(message.ts);
  const text = (message.text || "").trim() || "_(empty message)_";
  return `**${who}** · ${when}\n\n${text}`;
}

function filesToMarkdown(files = []) {
  if (!files.length) return "";
  const lines = ["## Files"];
  for (const file of files) {
    const label = file.title || file.name || file.id || "file";
    const url = file.permalink || file.url_private || "";
    const mime = file.mimetype || file.pretty_type || "";
    const link = url ? `[${label}](${url})` : label;
    lines.push(`- ${link}${mime ? ` (\`${mime}\`)` : ""}`);
    if (file.preview) {
      lines.push("");
      lines.push("```");
      lines.push(String(file.preview).slice(0, 4000));
      lines.push("```");
    }
  }
  return `\n\n${lines.join("\n")}`;
}

function threadToMarkdown({ channelId, messages, files }) {
  const root = messages[0] || {};
  const heading = `# Slack thread ${channelId}/${root.ts || "unknown"}`;
  const body = messages.map(messageToMarkdown).join("\n\n---\n\n");
  return `${heading}\n\n${body}${filesToMarkdown(files)}\n`;
}

async function enrichFiles(token, files = []) {
  if (!files.length || !token) return files;
  const enriched = [];
  for (const file of files) {
    if (!file?.id) {
      enriched.push(file);
      continue;
    }
    try {
      const data = await slackApi("files.info", token, { file: file.id });
      enriched.push({ ...file, ...(data.file || {}) });
    } catch {
      // files.info is best-effort; keep the original attachment metadata
      enriched.push(file);
    }
  }
  return enriched;
}

async function loadThreadMessages(token, channelId, item) {
  if (Array.isArray(item.messages) && item.messages.length > 0) {
    return [...item.messages].sort((a, b) => Number(a.ts) - Number(b.ts));
  }

  const threadTs = item.thread_ts || item.ts;
  const shouldFetchReplies =
    Boolean(token && threadTs) &&
    (item.reply_count > 0 || Boolean(item.latest_reply));
  if (shouldFetchReplies) {
    try {
      const messages = [];
      let cursor;
      do {
        const data = await slackApi("conversations.replies", token, {
          channel: channelId,
          ts: threadTs,
          limit: PAGE_SIZE,
          cursor,
        });
        messages.push(...(data.messages || []));
        cursor = data.has_more
          ? data.response_metadata?.next_cursor || null
          : null;
      } while (cursor);
      if (messages.length > 0) {
        return messages.sort((a, b) => Number(a.ts) - Number(b.ts));
      }
    } catch {
      // Fall through to the parent message from history
    }
  }

  return [
    {
      ts: item.ts,
      thread_ts: item.thread_ts || item.ts,
      text: item.text || "",
      user: item.user,
      files: item.files || [],
    },
  ];
}

function tsNewer(a, b) {
  if (!a) return false;
  if (!b) return true;
  return Number(a) > Number(b);
}

function includeHistoryMessage(message, oldest) {
  if (message.thread_ts && message.thread_ts !== message.ts) return false;
  if (!oldest) return true;
  return tsNewer(message.ts, oldest);
}

function knownThreadIds(ctx = {}) {
  const ids = ctx.config?.thread_ids || ctx.threadIds || [];
  return [
    ...new Set((Array.isArray(ids) ? ids : []).map(String).filter(Boolean)),
  ];
}

async function fetchThreadMessages(ctx, threadTs, { oldest } = {}) {
  const token = ctx.accessToken || ctx.userToken || ctx.botToken;
  if (!token || !ctx.channelId || !threadTs) return [];
  const messages = [];
  let cursor;
  do {
    const data = await slackApi("conversations.replies", token, {
      channel: ctx.channelId,
      ts: threadTs,
      limit: PAGE_SIZE,
      oldest: oldest || undefined,
      inclusive: true,
      cursor,
    });
    messages.push(...(data.messages || []));
    cursor = data.has_more ? data.response_metadata?.next_cursor || null : null;
  } while (cursor);
  return messages;
}

async function collectUpdatedThreads(ctx, oldest) {
  if (!oldest) return [];
  const threadIds = knownThreadIds(ctx).slice(0, MAX_WATCHED_THREADS);
  const items = [];
  for (const threadTs of threadIds) {
    let messages = [];
    try {
      messages = await fetchThreadMessages(ctx, threadTs, { oldest });
    } catch {
      continue;
    }
    const replies = messages.filter(
      (message) => message.ts !== threadTs && tsNewer(message.ts, oldest)
    );
    if (replies.length === 0) continue;
    const parent = messages.find((message) => message.ts === threadTs) || {
      ts: threadTs,
      thread_ts: threadTs,
      text: "",
      reply_count: replies.length,
      latest_reply: newestTs(replies),
    };
    const [item] = messagesToItems(
      [
        {
          ...parent,
          reply_count: parent.reply_count || replies.length,
          latest_reply: newestTs(replies) || parent.latest_reply,
        },
      ],
      ctx.channelId
    );
    item.messages = messages;
    items.push(item);
  }
  return items;
}

async function collectHistory(ctx, { oldest, cursor } = {}) {
  const messages = [];
  let pageCursor = cursor || undefined;
  let pages = 0;
  do {
    const data = await historyWithJoin(ctx, {
      cursor: pageCursor,
      oldest: oldest || undefined,
    });
    messages.push(...(data.messages || []));
    pageCursor = data.has_more
      ? data.response_metadata?.next_cursor || null
      : null;
    pages += 1;
  } while (pageCursor && pages < MAX_DELTA_PAGES);
  return messages;
}

function createSlackAdapter(defaults = {}) {
  return {
    async list(opts = {}) {
      const ctx = resolveContext(defaults, opts);
      const data = await historyWithJoin(ctx, { cursor: opts.cursor });
      const items = messagesToItems(
        (data.messages || []).filter((message) =>
          includeHistoryMessage(message, null)
        ),
        ctx.channelId
      );
      for (const item of items) {
        item.source = ctx.source;
      }
      return {
        items,
        cursor: data.response_metadata?.next_cursor || null,
      };
    },

    async download(item = {}) {
      const ctx = resolveContext(defaults, {}, item);
      const channelId = ctx.channelId;
      if (!channelId)
        throw new Error("Slack adapter requires a channel id (remote_id)");
      const messages = await loadThreadMessages(
        ctx.accessToken,
        channelId,
        item
      );
      const rawFiles = [
        ...(item.files || []),
        ...messages.flatMap((message) => message.files || []),
      ];
      const seen = new Set();
      const uniqueFiles = rawFiles.filter((file) => {
        const id = file.id || file.name;
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      const files = await enrichFiles(ctx.accessToken, uniqueFiles);
      const markdown = threadToMarkdown({ channelId, messages, files });
      const ts = item.thread_ts || item.ts || messages[0]?.ts || "thread";
      return {
        name: `slack-${channelId}-${ts}.md`,
        buffer: Buffer.from(markdown, "utf8"),
        mime: MIME_MARKDOWN,
        remoteId: `${channelId}/${ts}`,
        modifiedAt: formatTs(newestTs(messages) || ts),
      };
    },

    async delta(cursor, opts = {}) {
      const cursorOpts =
        cursor && typeof cursor === "object" && !Array.isArray(cursor)
          ? cursor
          : opts;
      const oldest =
        typeof cursor === "string"
          ? cursor
          : cursorOpts.cursor || opts.cursor || null;
      const ctx = resolveContext(defaults, cursorOpts);
      const messages = await collectHistory(ctx, { oldest });
      const changed = messages.filter((message) =>
        includeHistoryMessage(message, oldest)
      );
      const items = messagesToItems(changed, ctx.channelId);
      const replyItems = await collectUpdatedThreads(ctx, oldest);
      const seen = new Set(items.map((item) => item.thread_ts || item.ts));
      for (const item of replyItems) {
        const id = item.thread_ts || item.ts;
        if (seen.has(id)) continue;
        seen.add(id);
        items.push(item);
      }
      for (const item of items) {
        item.source = ctx.source;
      }
      const nextCursor =
        newestTs([
          ...messages.flatMap((message) =>
            [message.ts, message.latest_reply].filter(Boolean)
          ),
          ...replyItems.map((item) => item.latest_reply || item.ts),
        ]) ||
        oldest ||
        null;
      return {
        items,
        cursor: nextCursor,
      };
    },

    watchHint() {
      return { staleAfterMs: STALE_AFTER_MS };
    },

    toChunkSource(item = {}) {
      const channelId =
        item.channelId || item.channel || defaults.channelId || "unknown";
      const ts = item.thread_ts || item.ts || item.id || "unknown";
      return `slack://${channelId}/${ts}`;
    },
  };
}

const adapter = createSlackAdapter();
registerAdapter(PROVIDER, adapter);
DocumentSyncQueue.registerFileType(PROVIDER);

async function authUrl(redirectUri, state) {
  const config = await getSlackOAuthConfig();
  if (!config.clientId || !config.clientSecret) {
    return {
      success: false,
      error:
        "Slack is not configured. Add a Slack OAuth client ID and secret in Settings → Knowledge sources.",
    };
  }
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    scope: BOT_SCOPES,
    user_scope: USER_SCOPES,
    state,
  });
  return { success: true, url: `${SLACK_AUTHORIZE}?${params.toString()}` };
}

async function exchangeCode(code, redirectUri) {
  const config = await getSlackOAuthConfig();
  if (!config.clientId || !config.clientSecret)
    return { success: false, error: "Slack is not configured." };
  if (!code) return { success: false, error: "Missing OAuth code." };

  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: redirectUri,
  });
  const res = await fetch(SLACK_OAUTH_ACCESS, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    return {
      success: false,
      error: data.error || "Slack token exchange failed",
    };
  }

  const botToken = data.access_token || null;
  const userToken = data.authed_user?.access_token || null;
  const accessToken = botToken || userToken;
  if (!accessToken)
    return { success: false, error: "Slack did not return an access token." };

  const expiresIn = Number(
    data.expires_in || data.authed_user?.expires_in || 0
  );
  const tokenConfig = {
    access_token: accessToken,
    bot_token: botToken,
    user_token: userToken,
    refresh_token:
      data.refresh_token || data.authed_user?.refresh_token || null,
    team_id: data.team?.id || null,
    team_name: data.team?.name || null,
  };
  await ConnectedFileSource.upsertByProvider(PROVIDER, {
    access_token: tokenConfig.access_token,
    refresh_token: tokenConfig.refresh_token,
    token_expires_at: expiresIn
      ? new Date(Date.now() + Math.max(expiresIn - 60, 0) * 1000)
      : null,
    account_email: tokenConfig.team_id,
    account_name: tokenConfig.team_name,
  });
  await saveConnectionMeta({
    user_token: userToken,
    bot_token: botToken,
    team_id: tokenConfig.team_id,
    team_name: tokenConfig.team_name,
  });

  // Watched channels store their own copy of the token; refresh them too.
  const { KnowledgeSource } = require("../../../models/knowledgeSource");
  const sources = await KnowledgeSource.where({ provider: PROVIDER });
  for (const source of sources) {
    const existing = decryptSourceConfig(source);
    await KnowledgeSource.update(source.id, {
      config: { ...existing, ...tokenConfig },
    });
  }

  return {
    success: true,
    team: data.team || null,
  };
}

async function refreshSlackAccess(record) {
  const tokens = ConnectedFileSource.tokens(record);
  if (
    tokens.accessToken &&
    Date.now() < (tokens.expiresAt || Infinity) - 30_000
  )
    return tokens.accessToken;
  if (!tokens.refreshToken) return tokens.accessToken;

  const config = await getSlackOAuthConfig();
  if (!config.clientId || !config.clientSecret)
    throw new Error("Slack is not configured. Add client ID and secret.");

  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: "refresh_token",
    refresh_token: tokens.refreshToken,
  });
  const res = await fetch(SLACK_OAUTH_ACCESS, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false)
    throw new Error(data.error || "Slack token refresh failed");

  const accessToken = data.access_token || tokens.accessToken;
  const expiresIn = Number(data.expires_in || 0);
  await ConnectedFileSource.upsertByProvider(PROVIDER, {
    access_token: accessToken,
    refresh_token: data.refresh_token || tokens.refreshToken,
    token_expires_at: expiresIn
      ? new Date(Date.now() + Math.max(expiresIn - 60, 0) * 1000)
      : record.token_expires_at,
    account_email: record.account_email,
    account_name: record.account_name,
  });
  return accessToken;
}

async function getSlackConnection() {
  return ConnectedFileSource.get({ provider: PROVIDER });
}

async function saveConnectionMeta(meta = {}) {
  const { KnowledgeSource } = require("../../../models/knowledgeSource");
  const encrypted = KnowledgeSource.encryptConfig(meta || {});
  await SystemSettings._updateSettings({
    [SESSION_LABEL]: encrypted || "",
  });
}

async function getConnectionMeta() {
  const raw = (await SystemSettings.get({ label: SESSION_LABEL }))?.value;
  if (!raw) return {};
  const { KnowledgeSource } = require("../../../models/knowledgeSource");
  const decrypted = KnowledgeSource.decryptConfig(raw);
  if (decrypted && typeof decrypted === "object") return decrypted;
  // Migrate a leftover plaintext blob, then re-encrypt.
  const legacy = safeJsonParse(raw, null);
  if (legacy && typeof legacy === "object") {
    await saveConnectionMeta(legacy);
    return legacy;
  }
  return {};
}

async function clearConnectionMeta() {
  await saveConnectionMeta({});
}

async function tokenConfigFromConnection(record) {
  if (!record) return null;
  const tokens = ConnectedFileSource.tokens(record);
  if (!tokens.accessToken) return null;
  const meta = await getConnectionMeta();
  return {
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken || null,
    bot_token: meta.bot_token || tokens.accessToken,
    user_token: meta.user_token || null,
    team_id: record.account_email || null,
    team_name: record.account_name || null,
  };
}

async function listChannels() {
  const record = await getSlackConnection();
  if (!record) throw new Error("Slack is not connected.");
  const token = await refreshSlackAccess(record);
  const channels = [];
  let cursor = undefined;
  do {
    const data = await slackApi("conversations.list", token, {
      types: "public_channel,private_channel",
      exclude_archived: true,
      limit: PAGE_SIZE,
      cursor,
    });
    for (const channel of data.channels || []) {
      channels.push({
        id: channel.id,
        name: channel.name,
        isPrivate: Boolean(channel.is_private),
        numMembers: channel.num_members || 0,
      });
    }
    cursor = data.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return {
    channels,
    team: { id: record.account_email, name: record.account_name },
  };
}

module.exports = {
  PROVIDER,
  SCOPES,
  BOT_SCOPES,
  USER_SCOPES,
  PAGE_SIZE,
  STALE_AFTER_MS,
  CONFIG_LABEL,
  SESSION_LABEL,
  adapter,
  createSlackAdapter,
  slackApi,
  authUrl,
  exchangeCode,
  listChannels,
  getSlackOAuthConfig,
  publicSlackOAuthConfig,
  saveSlackOAuthConfig,
  getSlackConnection,
  tokenConfigFromConnection,
  refreshSlackAccess,
  messagesToItems,
  joinChannel,
  clearConnectionMeta,
  saveConnectionMeta,
  getConnectionMeta,
};
