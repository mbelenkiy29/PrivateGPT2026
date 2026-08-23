const { ConnectedFileSource } = require("../../models/connectedFileSource");
const { getFileSourceOAuthConfig } = require("./credentials");

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE = "https://www.googleapis.com/drive/v3";
const SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
].join(" ");

const FOLDER_MIME = "application/vnd.google-apps.folder";
const EXPORTS = {
  "application/vnd.google-apps.document": {
    mime: "text/plain",
    ext: ".txt",
  },
  "application/vnd.google-apps.spreadsheet": {
    mime: "text/csv",
    ext: ".csv",
  },
};

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

function isDocument(name = "", mimeType = "") {
  if (EXPORTS[mimeType]) return true;
  const ext = name.includes(".")
    ? `.${name.split(".").pop().toLowerCase()}`
    : "";
  return DOCUMENT_EXTS.has(ext);
}

function mapFile(file) {
  const folder = file.mimeType === FOLDER_MIME;
  return {
    id: file.id,
    name: file.name,
    type: folder ? "folder" : "file",
    size: Number(file.size || 0),
    modifiedAt: file.modifiedTime || null,
    mimeType: file.mimeType || null,
    webUrl: file.webViewLink || null,
    indexable: folder || isDocument(file.name, file.mimeType),
  };
}

async function drive(accessToken, path, { raw = false } = {}) {
  const res = await fetch(`${DRIVE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (raw) return res;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `Drive ${res.status}`;
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
  if (!config.google.clientId || !config.google.clientSecret)
    throw new Error("Google Drive is not configured. Add client ID and secret.");
  if (!tokens.refreshToken)
    throw new Error("Google Drive session expired. Reconnect the account.");

  const params = new URLSearchParams({
    client_id: config.google.clientId,
    client_secret: config.google.clientSecret,
    refresh_token: tokens.refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = await res.json();
  if (!res.ok)
    throw new Error(data.error_description || data.error || "Token refresh failed");

  await ConnectedFileSource.upsertByProvider("google-drive", {
    access_token: data.access_token,
    refresh_token: tokens.refreshToken,
    token_expires_at: new Date(Date.now() + (data.expires_in - 60) * 1000),
    account_email: record.account_email,
    account_name: record.account_name,
  });
  return data.access_token;
}

const GoogleDriveSource = {
  async authUrl(redirectUri, state) {
    const config = await getFileSourceOAuthConfig();
    if (!config.google.clientId || !config.google.clientSecret)
      return {
        success: false,
        error:
          "Google Drive is not configured. Add a Google OAuth client ID and secret in Settings → Cloud drives.",
      };
    const params = new URLSearchParams({
      client_id: config.google.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: SCOPES,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    });
    return { success: true, url: `${AUTH_URL}?${params.toString()}` };
  },

  async exchangeCode(code, redirectUri) {
    const config = await getFileSourceOAuthConfig();
    const params = new URLSearchParams({
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const data = await res.json();
    if (!res.ok)
      return {
        success: false,
        error:
          data.error_description || data.error || "Google token exchange failed",
      };

    const profileRes = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      { headers: { Authorization: `Bearer ${data.access_token}` } }
    );
    const profile = await profileRes.json().catch(() => ({}));

    await ConnectedFileSource.upsertByProvider("google-drive", {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_expires_at: new Date(Date.now() + (data.expires_in - 60) * 1000),
      account_email: profile.email || null,
      account_name: profile.name || null,
    });
    return { success: true };
  },

  async listChildren(record, parentId = "root") {
    const token = await refreshIfNeeded(record);
    const parent = parentId || "root";
    const q = encodeURIComponent(`'${parent}' in parents and trashed = false`);
    const fields = encodeURIComponent(
      "nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink)"
    );
    const data = await drive(
      token,
      `/files?q=${q}&pageSize=200&fields=${fields}&orderBy=folder,name`
    );
    return { items: (data.files || []).map(mapFile), next: data.nextPageToken || null };
  },

  async search(record, query) {
    const token = await refreshIfNeeded(record);
    const q = encodeURIComponent(
      `name contains '${query.replace(/'/g, "\\'")}' and trashed = false`
    );
    const fields = encodeURIComponent(
      "files(id,name,mimeType,size,modifiedTime,webViewLink)"
    );
    const data = await drive(token, `/files?q=${q}&pageSize=50&fields=${fields}`);
    return { items: (data.files || []).map(mapFile) };
  },

  async download(record, fileId) {
    const token = await refreshIfNeeded(record);
    const meta = await drive(
      token,
      `/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size`
    );
    if (meta.mimeType === FOLDER_MIME) {
      const children = await this.listChildren(record, fileId);
      return { kind: "folder", name: meta.name, children: children.items };
    }

    const exp = EXPORTS[meta.mimeType];
    let res;
    let filename = meta.name;
    if (exp) {
      res = await drive(
        token,
        `/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exp.mime)}`,
        { raw: true }
      );
      if (!filename.toLowerCase().endsWith(exp.ext)) filename += exp.ext;
    } else {
      res = await drive(
        token,
        `/files/${encodeURIComponent(fileId)}?alt=media`,
        { raw: true }
      );
    }
    if (!res.ok) throw new Error(`Failed to download ${meta.name}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    return { kind: "file", name: filename, buffer };
  },
};

module.exports = { GoogleDriveSource };
