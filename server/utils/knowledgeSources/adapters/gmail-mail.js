const { registerAdapter } = require("../adapter");
const {
  DELTA_CAP,
  WATCH_HINT,
  mailDownloadPayload,
  capItems,
  resolveConfig,
  registerWatchType,
} = require("../mail");

function decodeB64Url(data) {
  if (!data) return "";
  const padded = String(data).replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64").toString("utf8");
}

function headerMap(payload = {}) {
  const map = {};
  for (const h of payload.headers || []) {
    if (!h?.name) continue;
    map[String(h.name).toLowerCase()] = h.value || "";
  }
  return map;
}

function collectGmailParts(
  payload = {},
  acc = { text: "", html: "", attachments: [] }
) {
  const mime = (payload.mimeType || "").toLowerCase();
  const filename = payload.filename;
  if (
    filename &&
    payload.body &&
    (payload.body.attachmentId || payload.body.data)
  ) {
    acc.attachments.push(filename);
  }
  if (payload.body?.data) {
    const decoded = decodeB64Url(payload.body.data);
    if (mime === "text/plain" && !acc.text) acc.text = decoded;
    else if (mime === "text/html" && !acc.html) acc.html = decoded;
    else if (!acc.text && !acc.html) acc.text = decoded;
  }
  for (const part of payload.parts || []) collectGmailParts(part, acc);
  return acc;
}

function labelsAreSpamOrTrash(labelIds = []) {
  return labelIds.includes("SPAM") || labelIds.includes("TRASH");
}

function parseGmailMessage(msg = {}) {
  const headers = headerMap(msg.payload);
  const parts = collectGmailParts(msg.payload || {});
  const labels = msg.labelIds || [];
  return {
    id: msg.id,
    threadId: msg.threadId || msg.id,
    from: headers.from || "",
    to: headers.to || "",
    subject: headers.subject || msg.snippet || "",
    date:
      headers.date ||
      (msg.internalDate
        ? new Date(Number(msg.internalDate)).toISOString()
        : ""),
    body: parts.text || parts.html || msg.snippet || "",
    attachments: parts.attachments,
    labels,
    spamOrTrash: labelsAreSpamOrTrash(labels),
  };
}

async function keepNonSpamIds(gmailGet, ids, limit) {
  const kept = [];
  for (const id of ids) {
    if (kept.length >= limit) break;
    try {
      const msg = await gmailGet(`/messages/${id}?format=minimal`);
      if (!msg?.id || labelsAreSpamOrTrash(msg.labelIds || [])) continue;
      kept.push(msg.id);
    } catch {
      // deleted, trash, or otherwise unreadable
    }
  }
  return kept;
}

function gmailApiClient(config) {
  const headers = { Authorization: `Bearer ${config.accessToken}` };

  async function gmailGet(path) {
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me${path}`,
      { headers }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(
        data.error?.message || `Gmail API request failed (${res.status})`
      );
      err.status = res.status;
      throw err;
    }
    return data;
  }

  return {
    async list({ cursor, limit, includeSent }) {
      const q = includeSent
        ? "-in:spam -in:trash (in:inbox OR in:sent)"
        : "in:inbox -in:spam -in:trash";
      let historyId = null;
      let ids = [];

      if (cursor && !String(cursor).startsWith("bridge:")) {
        try {
          const hist = await gmailGet(
            `/history?startHistoryId=${encodeURIComponent(cursor)}&historyTypes=messageAdded&maxResults=${limit}`
          );
          historyId = hist.historyId || cursor;
          for (const entry of hist.history || []) {
            for (const added of entry.messagesAdded || []) {
              if (added.message?.id) ids.push(added.message.id);
            }
            for (const message of entry.messages || []) {
              if (message.id) ids.push(message.id);
            }
          }
          ids = [...new Set(ids)];
          ids = await keepNonSpamIds(gmailGet, ids, limit);
        } catch (e) {
          if (e.status !== 404 && e.status !== 410) throw e;
          ids = [];
          cursor = null;
        }
      }

      if (!cursor) {
        const listed = await gmailGet(
          `/messages?q=${encodeURIComponent(q)}&maxResults=${limit}`
        );
        ids = (listed.messages || []).map((m) => m.id).filter(Boolean);
        const profile = await gmailGet("/profile");
        historyId = profile.historyId || listed.historyId || historyId;
      }

      return {
        items: ids.slice(0, limit).map((id) => ({ id })),
        cursor: historyId || cursor || null,
      };
    },
    async get(item) {
      const msg = await gmailGet(`/messages/${item.id}?format=full`);
      const parsed = parseGmailMessage(msg);
      if (parsed.spamOrTrash) return null;
      return parsed;
    },
  };
}

function gmailBridgeClient(bridge) {
  return {
    async list({ cursor, limit, includeSent }) {
      const queries = ["in:inbox -in:spam -in:trash"];
      if (includeSent) queries.push("in:sent -in:spam -in:trash");
      const items = [];
      for (const query of queries) {
        const result = await bridge.search(query, limit);
        if (!result.success)
          throw new Error(result.error || "Gmail search failed");
        for (const thread of result.data?.threads || []) {
          items.push({
            id: thread.id,
            threadId: thread.id,
            subject: thread.subject,
            date: thread.lastMessageDate,
            from: thread.from,
            to: thread.to,
          });
        }
      }
      const after = cursor ? String(cursor).replace(/^bridge:/, "") : null;
      const afterMs = after ? Date.parse(after) : 0;
      const filtered = items
        .filter((item) => {
          if (!afterMs || !item.date) return true;
          const ts = Date.parse(item.date);
          return Number.isNaN(ts) || ts > afterMs;
        })
        .sort((a, b) => Date.parse(a.date || 0) - Date.parse(b.date || 0));
      const capped = filtered.slice(0, limit);
      const lastDate = capped[capped.length - 1]?.date;
      return {
        items: capped,
        cursor: lastDate ? `bridge:${lastDate}` : cursor || null,
      };
    },
    async get(item) {
      const result = await bridge.readThread(item.threadId || item.id);
      if (!result.success) throw new Error(result.error || "Gmail read failed");
      const messages = result.data?.messages || [];
      const first = messages[0] || {};
      const attachments = messages.flatMap((m) =>
        (m.attachments || []).map((a) => a.name).filter(Boolean)
      );
      return {
        id: item.id,
        from: first.from,
        to: first.to,
        subject: first.subject || result.data?.subject,
        date: first.date,
        body: messages
          .map((m) => m.body)
          .filter(Boolean)
          .join("\n\n"),
        attachments,
      };
    },
  };
}

async function resolveGmailClient(config = {}) {
  if (config.client) return config.client;
  if (config.accessToken) return gmailApiClient(config);

  const gmailLib = require("../../agents/aibitat/plugins/gmail/lib");
  const connected = await gmailLib.GmailBridge.isToolAvailable();
  if (config.useConnected !== false && connected)
    return gmailBridgeClient(gmailLib);

  throw new Error(
    "Gmail is not connected. Configure Gmail in Agent Skills or provide an access token in the knowledge source config."
  );
}

function createGmailMailAdapter({ config = {}, client } = {}) {
  let boundConfig = { ...config };

  async function getClient(cfg) {
    if (client) return client;
    if (cfg.client) return cfg.client;
    return resolveGmailClient(cfg);
  }

  async function collect(opts = {}, cursor) {
    const cfg = resolveConfig(opts, boundConfig);
    boundConfig = cfg;
    const api = await getClient(cfg);
    const result = await api.list({
      cursor: cursor ?? opts.cursor ?? null,
      limit: DELTA_CAP,
      includeSent: !!cfg.includeSent,
    });
    const items = [];
    for (const item of capItems(result?.items || [], DELTA_CAP)) {
      if (item.spamOrTrash) continue;
      items.push(item);
    }
    return { items, cursor: result?.cursor || cursor || null };
  }

  return {
    async list(opts = {}) {
      return collect(opts, opts.cursor);
    },
    async download(item) {
      const cfg = item?.config || boundConfig;
      let full = item;
      if (!item?.body) {
        const api = client || cfg.client || (await resolveGmailClient(cfg));
        if (api.get) {
          const fetched = await api.get(item);
          if (!fetched || fetched.spamOrTrash) {
            throw new Error("Gmail message is spam, trash, or unavailable.");
          }
          full = fetched;
        }
      }
      if (full?.spamOrTrash) throw new Error("Gmail message is spam or trash.");
      return mailDownloadPayload(full);
    },
    async delta(cursor, extra = {}) {
      const opts =
        cursor && typeof cursor === "object" && cursor.config
          ? cursor
          : { ...extra, cursor };
      return collect(opts, opts.cursor ?? cursor);
    },
    watchHint() {
      return { ...WATCH_HINT };
    },
    toChunkSource(item = {}) {
      return `gmail-mail://${item.id || item.threadId || ""}`;
    },
  };
}

const adapter = createGmailMailAdapter();
registerAdapter("gmail-mail", adapter);
registerWatchType("gmail-mail");

module.exports = adapter;
module.exports.createGmailMailAdapter = createGmailMailAdapter;
module.exports.gmailApiClient = gmailApiClient;
module.exports.parseGmailMessage = parseGmailMessage;
module.exports.labelsAreSpamOrTrash = labelsAreSpamOrTrash;
module.exports.PROVIDER = "gmail-mail";
