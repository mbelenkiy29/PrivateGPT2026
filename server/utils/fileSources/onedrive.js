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
  if (!res.ok) {
    const msg =
      data?.error?.message || data?.error_description || `Graph ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function refreshIfNeeded(record) {
  const tokens = ConnectedFileSource.tokens(record);
  if (tokens.accessToken && Date.now() < tokens.expiresAt - 30_000)
    return tokens.accessToken;

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
    scope: SCOPES,
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

  await ConnectedFileSource.upsertByProvider("onedrive", {
    access_token: data.access_token,
    refresh_token: data.refresh_token || tokens.refreshToken,
    token_expires_at: new Date(Date.now() + (data.expires_in - 60) * 1000),
    account_email: record.account_email,
    account_name: record.account_name,
  });
  return data.access_token;
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
          data.error_description || data.error || "OneDrive token exchange failed",
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
    const token = await refreshIfNeeded(record);
    const path =
      !parentId || parentId === "root"
        ? "/me/drive/root/children?$top=200&$select=id,name,folder,file,size,lastModifiedDateTime,webUrl"
        : `/me/drive/items/${encodeURIComponent(parentId)}/children?$top=200&$select=id,name,folder,file,size,lastModifiedDateTime,webUrl`;
    const data = await graph(token, path);
    const items = (data.value || []).map(mapItem);
    items.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return { items, next: data["@odata.nextLink"] || null };
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
    const token = await refreshIfNeeded(record);
    const meta = await graph(
      token,
      `/me/drive/items/${encodeURIComponent(fileId)}?$select=id,name,file,folder,size`
    );
    if (meta.folder) {
      const children = await this.listChildren(record, fileId);
      return { kind: "folder", name: meta.name, children: children.items };
    }
    const res = await graph(
      token,
      `/me/drive/items/${encodeURIComponent(fileId)}/content`,
      { raw: true }
    );
    if (!res.ok) throw new Error(`Failed to download ${meta.name}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    return { kind: "file", name: meta.name, buffer };
  },
};

module.exports = { OneDriveSource };
