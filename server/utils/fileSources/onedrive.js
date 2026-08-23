const { ConnectedFileSource } = require("../../models/connectedFileSource");
const { getFileSourceOAuthConfig } = require("./credentials");

const AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0";
const GRAPH = "https://graph.microsoft.com/v1.0";
const SCOPES = ["offline_access", "User.Read", "Files.Read"].join(" ");

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

function mapItem(item) {
  const folder = Boolean(item.folder);
  return {
    id: item.id,
    name: item.name,
    type: folder ? "folder" : "file",
    size: item.size || 0,
    modifiedAt: item.lastModifiedDateTime || null,
    mimeType: item.file?.mimeType || null,
    webUrl: item.webUrl || null,
    indexable: folder || isDocument(item.name),
  };
}

async function graph(accessToken, path, { method = "GET", raw = false } = {}) {
  const res = await fetch(`${GRAPH}${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}` },
    redirect: raw ? "follow" : "follow",
  });
  if (raw) return res;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw graphError(res, data);
  return data;
}

function graphError(res, data = {}) {
  const msg =
    data?.error?.message || data?.error_description || `Graph ${res.status}`;
  const err = new Error(msg);
  err.status = res.status;
  err.code = data?.error?.code || null;
  err.graph = data?.error || null;
  return err;
}

function driveItemPath(driveId, itemId = "root") {
  if (driveId) {
    if (!itemId || itemId === "root")
      return `/drives/${encodeURIComponent(driveId)}/root`;
    return `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`;
  }
  if (!itemId || itemId === "root") return "/me/drive/root";
  return `/me/drive/items/${encodeURIComponent(itemId)}`;
}

function sortItems(items) {
  items.sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
  return items;
}

/**
 * Refresh a Microsoft Graph token. Scope is omitted so Azure keeps the
 * originally granted set (SharePoint/Teams add Sites.Read.All etc.).
 */
async function refreshIfNeeded(record) {
  const tokens = ConnectedFileSource.tokens(record);
  if (tokens.accessToken && Date.now() < tokens.expiresAt - 30_000)
    return tokens.accessToken;

  const provider = record?.provider || "onedrive";
  const config = await getFileSourceOAuthConfig();
  if (!config.onedrive.clientId || !config.onedrive.clientSecret)
    throw new Error("OneDrive is not configured. Add client ID and secret.");
  if (!tokens.refreshToken)
    throw new Error("OneDrive session expired. Reconnect the account.");

  const params = new URLSearchParams({
    client_id: config.onedrive.clientId,
    client_secret: config.onedrive.clientSecret,
    refresh_token: tokens.refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(`${AUTH_URL}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = await res.json();
  if (!res.ok)
    throw new Error(
      data.error_description || data.error || "Failed to refresh OneDrive token"
    );

  await ConnectedFileSource.upsertByProvider(provider, {
    access_token: data.access_token,
    refresh_token: data.refresh_token || tokens.refreshToken,
    token_expires_at: new Date(Date.now() + (data.expires_in - 60) * 1000),
    account_email: record.account_email,
    account_name: record.account_name,
  });
  return data.access_token;
}

const CHILDREN_SELECT =
  "$top=200&$select=id,name,folder,file,size,lastModifiedDateTime,webUrl,parentReference";

async function listDriveChildren(record, driveId, itemId = "root") {
  const token = await refreshIfNeeded(record);
  const data = await graph(
    token,
    `${driveItemPath(driveId, itemId)}/children?${CHILDREN_SELECT}`
  );
  const items = sortItems((data.value || []).map(mapItem));
  return { items, next: data["@odata.nextLink"] || null };
}

async function downloadDriveItem(record, itemId, driveId = null) {
  const token = await refreshIfNeeded(record);
  const base = driveItemPath(driveId, itemId);
  const meta = await graph(
    token,
    `${base}?$select=id,name,file,folder,size,parentReference`
  );
  if (meta.folder) {
    const children = await listDriveChildren(record, driveId, itemId);
    return {
      kind: "folder",
      name: meta.name,
      children: children.items,
      driveId: driveId || meta.parentReference?.driveId || null,
      itemId: meta.id,
    };
  }
  const res = await graph(token, `${base}/content`, { raw: true });
  if (!res.ok) throw new Error(`Failed to download ${meta.name}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  return {
    kind: "file",
    name: meta.name,
    buffer,
    driveId: driveId || meta.parentReference?.driveId || null,
    itemId: meta.id,
  };
}

function mapDeltaItem(item) {
  if (item.deleted || item["@removed"]) {
    return { id: item.id, name: item.name, deleted: true };
  }
  return mapItem(item);
}

/**
 * One page of Graph delta for a drive item. `cursor` is a deltaLink or
 * nextLink URL from a previous page, or null to start from the item.
 */
async function deltaDriveItem(
  record,
  { driveId = null, itemId = "root", cursor = null, map = mapDeltaItem } = {}
) {
  const token = await refreshIfNeeded(record);
  let data;
  if (cursor && /^https?:\/\//i.test(cursor)) {
    const res = await fetch(cursor, {
      headers: { Authorization: `Bearer ${token}` },
    });
    data = await res.json().catch(() => ({}));
    if (!res.ok) throw graphError(res, data);
  } else {
    data = await graph(
      token,
      `${driveItemPath(driveId, itemId)}/delta?$top=200`
    );
  }

  return {
    items: (data.value || []).map(map),
    nextLink: data["@odata.nextLink"] || null,
    deltaLink: data["@odata.deltaLink"] || null,
  };
}

async function getDeltaLinkForDrive(record, opts = {}) {
  let cursor = null;
  const seen = new Set();
  for (let i = 0; i < 100; i++) {
    const page = await deltaDriveItem(record, { ...opts, cursor });
    if (page.deltaLink) return page.deltaLink;
    if (!page.nextLink || seen.has(page.nextLink)) {
      return page.nextLink || cursor;
    }
    seen.add(page.nextLink);
    cursor = page.nextLink;
  }
  return cursor;
}

const OneDriveSource = {
  async authUrl(redirectUri, state) {
    const config = await getFileSourceOAuthConfig();
    if (!config.onedrive.clientId || !config.onedrive.clientSecret)
      return {
        success: false,
        error:
          "OneDrive is not configured. Add a Microsoft app client ID and secret in Settings → Cloud drives.",
      };
    const params = new URLSearchParams({
      client_id: config.onedrive.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      response_mode: "query",
      scope: SCOPES,
      state,
    });
    return {
      success: true,
      url: `${AUTH_URL}/authorize?${params.toString()}`,
    };
  },

  async exchangeCode(code, redirectUri) {
    const config = await getFileSourceOAuthConfig();
    const params = new URLSearchParams({
      client_id: config.onedrive.clientId,
      client_secret: config.onedrive.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      scope: SCOPES,
    });
    const res = await fetch(`${AUTH_URL}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const data = await res.json();
    if (!res.ok)
      return {
        success: false,
        error:
          data.error_description ||
          data.error ||
          "OneDrive token exchange failed",
      };

    const me = await graph(data.access_token, "/me");
    await ConnectedFileSource.upsertByProvider("onedrive", {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_expires_at: new Date(Date.now() + (data.expires_in - 60) * 1000),
      account_email: me.mail || me.userPrincipalName || null,
      account_name: me.displayName || null,
    });
    return { success: true };
  },

  async listChildren(record, parentId = "root") {
    return listDriveChildren(record, null, parentId);
  },

  async search(record, query) {
    const token = await refreshIfNeeded(record);
    const q = encodeURIComponent(query);
    const data = await graph(
      token,
      `/me/drive/root/search(q='${q}')?$top=50&$select=id,name,folder,file,size,lastModifiedDateTime,webUrl`
    );
    return { items: (data.value || []).map(mapItem) };
  },

  async download(record, fileId) {
    return downloadDriveItem(record, fileId);
  },

  /**
   * One page of Graph delta for a folder. `cursor` is a deltaLink or nextLink
   * URL from a previous page, or null to start from the folder.
   */
  async delta(record, folderId = "root", cursor = null) {
    return deltaDriveItem(record, { itemId: folderId, cursor });
  },

  /**
   * Walk Graph delta pages until a deltaLink is returned so indexing can
   * snapshot the stream without re-embedding the folder on the first job.
   */
  async getDeltaLink(record, folderId = "root") {
    return getDeltaLinkForDrive(record, { itemId: folderId });
  },
};

module.exports = {
  OneDriveSource,
  AUTH_URL,
  GRAPH,
  SCOPES,
  graph,
  mapItem,
  isDocument,
  refreshIfNeeded,
  listDriveChildren,
  downloadDriveItem,
  deltaDriveItem,
  getDeltaLinkForDrive,
  driveItemPath,
};
