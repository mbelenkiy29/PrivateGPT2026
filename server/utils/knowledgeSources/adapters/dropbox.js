const { registerAdapter } = require("../adapter");

const PROVIDER = "dropbox";
const AUTH_URL = "https://www.dropbox.com/oauth2/authorize";
const TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
const RPC_URL = "https://api.dropboxapi.com/2";
const CONTENT_URL = "https://content.dropboxapi.com/2";
const ITEM_CAP = 200;
const STALE_AFTER_MS = 3600000; // 1 hour
const SCOPES = [
  "files.metadata.read",
  "files.content.read",
  "account_info.read",
];

const DOCUMENT_EXTS = new Set([
  ".txt",
  ".md",
  ".pdf",
  ".docx",
  ".doc",
  ".pptx",
  ".xlsx",
  ".csv",
  ".json",
  ".html",
  ".odt",
  ".odp",
  ".rtf",
  ".epub",
]);

function isDocument(name = "") {
  const ext = name.includes(".")
    ? `.${name.split(".").pop().toLowerCase()}`
    : "";
  return DOCUMENT_EXTS.has(ext);
}

function normalizePath(folderId) {
  if (!folderId || folderId === "root" || folderId === "/") return "";
  return folderId.startsWith("/") ? folderId : `/${folderId}`;
}

function itemPath(item = {}) {
  return (
    item.path_display ||
    item.path_lower ||
    item.path ||
    item.remoteId ||
    item.id ||
    ""
  );
}

function mapEntry(entry) {
  const folder = entry[".tag"] === "folder";
  const deleted = entry[".tag"] === "deleted";
  const name = entry.name || itemPath(entry).split("/").pop() || "";
  return {
    id: entry.id || itemPath(entry),
    name,
    path: itemPath(entry),
    path_display: entry.path_display || itemPath(entry),
    type: folder ? "folder" : deleted ? "deleted" : "file",
    size: Number(entry.size || 0),
    modifiedAt: entry.server_modified || entry.client_modified || null,
    indexable: folder || isDocument(name),
    deleted,
  };
}

function guessMime(name = "") {
  const ext = name.includes(".")
    ? `.${name.split(".").pop().toLowerCase()}`
    : "";
  const types = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".pdf": "application/pdf",
    ".docx":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".doc": "application/msword",
    ".pptx":
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".xlsx":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".csv": "text/csv",
    ".json": "application/json",
    ".html": "text/html",
    ".rtf": "application/rtf",
    ".epub": "application/epub+zip",
  };
  return types[ext] || "application/octet-stream";
}

async function readJson(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error_summary: text };
  }
}

function defaultDropboxClient(accessToken) {
  return {
    async rpc(endpoint, body) {
      const res = await fetch(`${RPC_URL}/${endpoint}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body === undefined ? {} : body),
      });
      const data = await readJson(res);
      if (!res.ok) {
        const err = new Error(
          data.error_summary ||
            data.error_description ||
            `Dropbox ${res.status}`
        );
        err.status = res.status;
        err.body = data;
        throw err;
      }
      return data;
    },
    async download(path) {
      const res = await fetch(`${CONTENT_URL}/files/download`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Dropbox-API-Arg": JSON.stringify({ path }),
        },
      });
      if (!res.ok) {
        const data = await readJson(res);
        const err = new Error(
          data.error_summary || `Dropbox download ${res.status}`
        );
        err.status = res.status;
        throw err;
      }
      const metaHeader = res.headers.get("dropbox-api-result");
      const meta = metaHeader ? JSON.parse(metaHeader) : { path_display: path };
      const buffer = Buffer.from(await res.arrayBuffer());
      return { buffer, meta };
    },
  };
}

async function exchangeToken(params) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const data = await readJson(res);
  if (!res.ok) {
    return {
      success: false,
      error:
        data.error_description ||
        data.error_summary ||
        data.error ||
        "Dropbox token exchange failed",
    };
  }
  return { success: true, ...data };
}

async function refreshAccessToken(
  refreshToken,
  { clientId, clientSecret } = {}
) {
  if (!refreshToken) throw new Error("Dropbox session expired. Reconnect.");
  if (!clientId || !clientSecret)
    throw new Error("Dropbox is not configured. Add app key and secret.");
  const result = await exchangeToken({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
  if (!result.success) throw new Error(result.error);
  return result;
}

function takeEntry(items, liveCount, entry, cap) {
  const mapped = mapEntry(entry);
  // Removals never consume ITEM_CAP so a burst of new files cannot hide deletes.
  if (mapped.deleted) {
    items.push(mapped);
    return liveCount;
  }
  if (liveCount < cap) {
    items.push(mapped);
    return liveCount + 1;
  }
  return liveCount;
}

/**
 * Walk list_folder / continue. Live files are capped at ITEM_CAP; `.tag ===
 * "deleted"` entries are always kept. The native cursor is still drained so
 * the next watch only sees later changes — remaining live files past the cap
 * are skipped (ingest cap), but deletions in that window are not.
 *
 * `include_deleted` is set on the *original* list_folder call. Dropbox
 * continue inherits that flag; passing it only on continue is a no-op.
 */
async function collectEntries(
  client,
  { path, cursor, recursive, includeDeleted = true } = {}
) {
  const items = [];
  let liveCount = 0;
  let next = cursor || null;
  let hasMore = true;
  const withDeletes = includeDeleted !== false;

  if (!next) {
    const data = await client.rpc("files/list_folder", {
      path: normalizePath(path),
      recursive: Boolean(recursive),
      include_deleted: withDeletes,
      limit: ITEM_CAP,
    });
    for (const entry of data.entries || []) {
      liveCount = takeEntry(items, liveCount, entry, ITEM_CAP);
    }
    next = data.cursor || null;
    hasMore = Boolean(data.has_more);
  }

  while (hasMore && next) {
    const data = await client.rpc("files/list_folder/continue", {
      cursor: next,
    });
    for (const entry of data.entries || []) {
      liveCount = takeEntry(items, liveCount, entry, ITEM_CAP);
    }
    next = data.cursor || next;
    hasMore = Boolean(data.has_more);
  }

  return { items, cursor: next };
}

function storedTokens(config = {}) {
  return {
    accessToken: config.accessToken || config.access_token || null,
    refreshToken: config.refreshToken || config.refresh_token || null,
    expiresAt: config.expiresAt || config.token_expires_at || null,
    clientId: config.clientId || config.client_id || null,
    clientSecret: config.clientSecret || config.client_secret || null,
  };
}

function createDropboxAdapter(config = {}) {
  const pathOf = (opts = {}) =>
    opts.folderId || opts.path || config.path || config.folderId || "";

  function clientOf(accessToken) {
    if (config.client) return config.client;
    if (!accessToken) throw new Error("Dropbox access token is required.");
    return defaultDropboxClient(accessToken);
  }

  async function withClient() {
    const tokens = storedTokens(config);
    let accessToken = tokens.accessToken;
    const expired =
      tokens.expiresAt &&
      Number(new Date(tokens.expiresAt)) - 30_000 < Date.now();
    if ((!accessToken || expired) && tokens.refreshToken) {
      const refreshed = await refreshAccessToken(tokens.refreshToken, {
        clientId: tokens.clientId,
        clientSecret: tokens.clientSecret,
      });
      accessToken = refreshed.access_token;
      config.accessToken = accessToken;
      config.access_token = accessToken;
      config.refreshToken = tokens.refreshToken;
      config.refresh_token = tokens.refreshToken;
      if (refreshed.expires_in) {
        const nextExpiry = new Date(
          Date.now() + (refreshed.expires_in - 60) * 1000
        );
        config.expiresAt = nextExpiry;
        config.token_expires_at = nextExpiry;
      }
      if (typeof config.onTokens === "function") {
        await config.onTokens({
          access_token: accessToken,
          refresh_token: tokens.refreshToken,
          token_expires_at: config.expiresAt,
        });
      }
    }
    return clientOf(accessToken);
  }

  return {
    async list(opts = {}) {
      const client = await withClient();
      const recursive = opts.recursive !== false;
      const includeDeleted = opts.includeDeleted !== false;
      const listed = await collectEntries(client, {
        path: pathOf(opts),
        cursor: opts.cursor || null,
        recursive,
        includeDeleted,
      });
      return {
        items: listed.items.filter((item) => !item.deleted),
        cursor: listed.cursor,
      };
    },

    async listChildren(path = "") {
      const client = await withClient();
      const data = await client.rpc("files/list_folder", {
        path: normalizePath(path),
        recursive: false,
        include_deleted: false,
        limit: ITEM_CAP,
      });
      return {
        items: (data.entries || []).map(mapEntry),
        cursor: data.cursor || null,
        hasMore: Boolean(data.has_more),
      };
    },

    async download(item = {}) {
      const client = await withClient();
      const path = itemPath(item);
      if (!path) throw new Error("Dropbox path is required.");
      if (item.type === "folder")
        throw new Error("Cannot download a Dropbox folder as a file.");
      const { buffer, meta } = await client.download(path);
      const name = meta.name || item.name || path.split("/").pop();
      return {
        name,
        buffer,
        mime: guessMime(name),
        remoteId: meta.id || path,
        modifiedAt: meta.server_modified || item.modifiedAt || null,
        path: meta.path_display || path,
      };
    },

    /**
     * Remote removals stay in `items` with `deleted: true`. The sync job
     * must unembed those and not download them. Always starts/continues with
     * include_deleted so Dropbox continue inherits deletions.
     */
    async delta(cursor) {
      const client = await withClient();
      const listed = await collectEntries(client, {
        path: pathOf({}),
        cursor: cursor || null,
        recursive: true,
        includeDeleted: true,
      });
      return { items: listed.items, cursor: listed.cursor };
    },

    watchHint() {
      return { staleAfterMs: STALE_AFTER_MS, poll: true };
    },

    toChunkSource(item = {}) {
      const path = String(itemPath(item)).replace(/^\//, "");
      return `dropbox://${path}`;
    },
  };
}

function authUrl(redirectUri, state, { clientId } = {}) {
  if (!clientId)
    return {
      success: false,
      error:
        "Dropbox is not configured. Add an app key and secret in Settings → Knowledge sources.",
    };
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    token_access_type: "offline",
    scope: SCOPES.join(" "),
    state,
  });
  return { success: true, url: `${AUTH_URL}?${params.toString()}` };
}

async function exchangeCode(
  code,
  redirectUri,
  { clientId, clientSecret } = {}
) {
  if (!clientId || !clientSecret)
    return {
      success: false,
      error: "Dropbox is not configured. Add an app key and secret.",
    };
  const result = await exchangeToken({
    code,
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
  });
  if (!result.success) return result;

  let account_email = null;
  let account_name = null;
  try {
    const client = defaultDropboxClient(result.access_token);
    const account = await client.rpc("users/get_current_account", null);
    account_email = account.email || null;
    account_name = account.name?.display_name || null;
  } catch {
    // Account lookup is best-effort; tokens are still valid.
  }

  return {
    success: true,
    access_token: result.access_token,
    refresh_token: result.refresh_token || null,
    expires_in: result.expires_in,
    account_email,
    account_name,
  };
}

const DropboxAdapter = {
  provider: PROVIDER,
  create: createDropboxAdapter,
  authUrl,
  exchangeCode,
  refreshAccessToken,
  ITEM_CAP,
  STALE_AFTER_MS,
  ...createDropboxAdapter({}),
};

registerAdapter(PROVIDER, DropboxAdapter);

module.exports = {
  DropboxAdapter,
  createDropboxAdapter,
  defaultDropboxClient,
  authUrl,
  exchangeCode,
  refreshAccessToken,
  mapEntry,
  normalizePath,
  isDocument,
  collectEntries,
  storedTokens,
  ITEM_CAP,
  STALE_AFTER_MS,
  PROVIDER,
};
