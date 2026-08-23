const { registerAdapter } = require("../adapter");
const {
  DELTA_CAP,
  WATCH_HINT,
  mailDownloadPayload,
  capItems,
  parseJsonCursor,
  stringifyCursor,
  resolveConfig,
  registerWatchType,
  isSkippedMailbox,
} = require("../mail");

function addressesOf(recipients = []) {
  return (recipients || [])
    .map((r) => r.emailAddress?.address)
    .filter(Boolean)
    .join(", ");
}

function mapGraphMessage(msg = {}) {
  const removed = !!msg["@removed"];
  return {
    id: msg.id,
    from: msg.from?.emailAddress?.address || msg.from || "",
    to: msg.toRecipients ? addressesOf(msg.toRecipients) : msg.to || "",
    subject: msg.subject || "",
    date: msg.receivedDateTime || msg.date || "",
    body: msg.body?.content || msg.body || "",
    bodyType: msg.body?.contentType || msg.bodyType,
    hasAttachments: !!msg.hasAttachments,
    attachments: (msg.attachments || []).map((att) => att.name).filter(Boolean),
    parentFolderId: msg.parentFolderId,
    deleted: removed,
  };
}

function graphClientFromToken(config) {
  return {
    async request(endpoint, options = {}) {
      const url = endpoint.startsWith("http")
        ? endpoint
        : `https://graph.microsoft.com/v1.0${endpoint}`;
      const res = await fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          "Content-Type": "application/json",
          ...options.headers,
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          success: false,
          error: data.error?.message || `Graph request failed (${res.status})`,
        };
      }
      return { success: true, data };
    },
  };
}

async function resolveOutlookBridge(config = {}) {
  if (config.client) return config.client;
  if (config.request) return { request: config.request };

  const outlookLib = require("../../agents/aibitat/plugins/outlook/lib");
  const connected = await outlookLib.OutlookBridge.isToolAvailable();
  if (config.useConnected !== false && connected) return outlookLib;
  if (config.accessToken) return graphClientFromToken(config);

  throw new Error(
    "Outlook is not connected. Configure Outlook in Agent Skills or provide an access token in the knowledge source config."
  );
}

function createOutlookMailAdapter({ config = {}, client } = {}) {
  let boundConfig = { ...config };

  async function getBridge(cfg) {
    if (client) return client;
    return resolveOutlookBridge(cfg);
  }

  async function listFolder(bridge, folder, storedCursor, remaining) {
    if (remaining <= 0) return { items: [], cursor: storedCursor || null };

    const items = [];
    let pending = [];
    let url;
    if (storedCursor && typeof storedCursor === "object") {
      pending = Array.isArray(storedCursor.pending)
        ? storedCursor.pending.filter(Boolean)
        : [];
      url = storedCursor.resume || null;
    } else if (typeof storedCursor === "string" && storedCursor) {
      url = storedCursor;
    } else {
      url = `/me/mailFolders/${folder}/messages/delta?$top=${remaining}&$select=id,subject,from,toRecipients,receivedDateTime,body,hasAttachments,parentFolderId,conversationId`;
    }

    while (pending.length && items.length < remaining) {
      items.push({ id: pending.shift() });
    }
    if (items.length >= remaining) {
      return {
        items,
        cursor: pending.length || url ? { pending, resume: url } : url || null,
      };
    }

    const requestOpts = {
      headers: { Prefer: `odata.maxpagesize=${remaining - items.length}` },
    };

    while (url && items.length < remaining) {
      const result = await bridge.request(url, requestOpts);
      if (!result.success)
        throw new Error(result.error || `Outlook delta failed for ${folder}`);
      const data = result.data || {};
      const page = [];
      for (const msg of data.value || []) {
        const mapped = mapGraphMessage(msg);
        if (!mapped.deleted) page.push(mapped);
      }
      const need = remaining - items.length;
      const resume =
        data["@odata.nextLink"] || data["@odata.deltaLink"] || null;
      if (page.length > need) {
        items.push(...page.slice(0, need));
        return {
          items,
          cursor: {
            pending: page
              .slice(need)
              .map((m) => m.id)
              .filter(Boolean),
            resume,
          },
        };
      }
      items.push(...page);
      if (data["@odata.nextLink"] && items.length < remaining) {
        url = data["@odata.nextLink"];
        continue;
      }
      return { items, cursor: resume };
    }

    return { items, cursor: url || storedCursor || null };
  }

  async function collect(opts = {}, cursor) {
    const cfg = resolveConfig(opts, boundConfig);
    boundConfig = cfg;
    const bridge = await getBridge(cfg);
    const folders = cfg.includeSent ? ["inbox", "sentitems"] : ["inbox"];
    const cursorMap = parseJsonCursor(cursor ?? opts.cursor, "inbox");
    const items = [];
    const nextCursor = { ...cursorMap };
    for (const folder of folders) {
      if (items.length >= DELTA_CAP) break;
      const listed = await listFolder(
        bridge,
        folder,
        cursorMap[folder] || null,
        DELTA_CAP - items.length
      );
      for (const item of listed.items) {
        if (isSkippedMailbox(item.folderName || folder)) continue;
        items.push(item);
      }
      if (listed.cursor) nextCursor[folder] = listed.cursor;
    }
    return {
      items: capItems(items, DELTA_CAP),
      cursor: stringifyCursor(nextCursor),
    };
  }

  return {
    async list(opts = {}) {
      return collect(opts, opts.cursor);
    },
    async download(item) {
      const cfg = item?.config || boundConfig;
      let full = item;
      if (!item?.body && item?.id) {
        const bridge = client || (await resolveOutlookBridge(cfg));
        const result = await bridge.request(
          `/me/messages/${item.id}?$select=id,subject,from,toRecipients,receivedDateTime,body,hasAttachments&$expand=attachments`
        );
        if (result.success) full = mapGraphMessage(result.data);
      }
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
      return `outlook-mail://${item.id || ""}`;
    },
  };
}

const adapter = createOutlookMailAdapter();
registerAdapter("outlook-mail", adapter);
registerWatchType("outlook-mail");

module.exports = adapter;
module.exports.createOutlookMailAdapter = createOutlookMailAdapter;
module.exports.mapGraphMessage = mapGraphMessage;
module.exports.PROVIDER = "outlook-mail";
