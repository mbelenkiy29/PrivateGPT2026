const { registerAdapter } = require("../adapter");
const { DocumentSyncQueue } = require("../../../models/documentSyncQueue");
const { SystemSettings } = require("../../../models/systemSettings");
const { ConnectedFileSource } = require("../../../models/connectedFileSource");
const { looksMasked } = require("../../fileSources/credentials");
const { safeJsonParse } = require("../../http");

const SLACK_AUTHORIZE = "https://slack.com/oauth/v2/authorize";
const SLACK_OAUTH_ACCESS = "https://slack.com/api/oauth.v2.access";
const SLACK_API = "https://slack.com/api";
const SCOPES = "channels:history,files:read,channels:read";
const PAGE_SIZE = 200;
const CONFIG_LABEL = "slack_oauth_config";
const PROVIDER = "slack";
const STALE_AFTER_MS = 3_600_000;
const MIME_MARKDOWN = "text/markdown";

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
    config.access_token ||
    config.bot_token ||
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
  return { accessToken, channelId, config, source };
}

function formatTs(ts) {
  const ms = Number(ts) * 1000;
  if (!Number.isFinite(ms)) return String(ts || "");
  return new Date(ms).toISOString();
}

function newestTs(messages = []) {
  let max = null;
  for (const message of messages) {
    if (!message?.ts) continue;
    if (!max || Number(message.ts) > Number(max)) max = message.ts;
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
  if (item.reply_count > 0 && threadTs && token) {
    try {
      const data = await slackApi("conversations.replies", token, {
        channel: channelId,
        ts: threadTs,
        limit: PAGE_SIZE,
      });
      return (data.messages || []).sort((a, b) => Number(a.ts) - Number(b.ts));
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

async function historyPage(token, channelId, { cursor, oldest } = {}) {
  if (!channelId)
    throw new Error("Slack adapter requires a channel id (remote_id)");
  return slackApi("conversations.history", token, {
    channel: channelId,
    limit: PAGE_SIZE,
    cursor: cursor || undefined,
    oldest: oldest || undefined,
  });
}

function createSlackAdapter(defaults = {}) {
  return {
    async list(opts = {}) {
      const ctx = resolveContext(defaults, opts);
      const data = await historyPage(ctx.accessToken, ctx.channelId, {
        cursor: opts.cursor,
      });
      const items = messagesToItems(data.messages || [], ctx.channelId);
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
      const data = await historyPage(ctx.accessToken, ctx.channelId, {
        oldest: oldest || undefined,
      });
      const messages = (data.messages || []).filter(
        (message) => !oldest || message.ts !== oldest
      );
      const items = messagesToItems(messages, ctx.channelId);
      for (const item of items) {
        item.source = ctx.source;
      }
      return {
        items,
        cursor: newestTs(messages) || oldest || null,
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
    scope: SCOPES,
    user_scope: SCOPES,
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

  const accessToken = data.access_token || data.authed_user?.access_token;
  if (!accessToken)
    return { success: false, error: "Slack did not return an access token." };

  const expiresIn = Number(
    data.expires_in || data.authed_user?.expires_in || 0
  );
  const tokenConfig = {
    access_token: accessToken,
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

function tokenConfigFromConnection(record) {
  if (!record) return null;
  const tokens = ConnectedFileSource.tokens(record);
  if (!tokens.accessToken) return null;
  return {
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken || null,
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
  PAGE_SIZE,
  STALE_AFTER_MS,
  CONFIG_LABEL,
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
};
