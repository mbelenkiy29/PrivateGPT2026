const crypto = require("crypto");
const { reqBody } = require("../utils/http");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { KnowledgeSource } = require("../models/knowledgeSource");
const { Workspace } = require("../models/workspace");
const { ConnectedFileSource } = require("../models/connectedFileSource");
const { DocumentSyncQueue } = require("../models/documentSyncQueue");
const {
  getNotionToken,
  saveNotionToken,
  getDropboxOAuthConfig,
  saveDropboxOAuthConfig,
  publicDropboxConfig,
} = require("../utils/knowledgeSources/credentials");
const {
  createNotionAdapter,
  verifyToken,
} = require("../utils/knowledgeSources/adapters/notion");
const {
  createDropboxAdapter,
  authUrl: dropboxAuthUrl,
  exchangeCode: dropboxExchangeCode,
} = require("../utils/knowledgeSources/adapters/dropbox");

DocumentSyncQueue.registerFileType("notion");
DocumentSyncQueue.registerFileType("dropbox");

const pendingOAuth = new Map();
const OAUTH_TTL_MS = 10 * 60 * 1000;

function getRedirectUri(request, provider) {
  const protocol = request.headers["x-forwarded-proto"] || request.protocol;
  const host = request.headers["x-forwarded-host"] || request.get("host");
  return `${protocol}://${host}/api/knowledge-sources/${provider}/callback`;
}

function originFromUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:")
      return url.origin;
  } catch {
    // ignore
  }
  return null;
}

function openerOrigin(request) {
  const header = request.headers.origin;
  if (header) return originFromUrl(header) || header;
  return originFromUrl(request.headers.referer);
}

function callbackOrigin(request, provider) {
  return originFromUrl(getRedirectUri(request, provider));
}

function popupHtml({ success, error, provider, targetOrigin }) {
  const payload = JSON.stringify({
    type: "knowledge-source-oauth",
    success,
    error: error ? String(error) : null,
    provider,
  });
  // Never interpolate the error into HTML; JSON.stringify covers the script.
  const visible = success
    ? "Connected. You can close this window."
    : "Could not connect. You can close this window.";
  const origin = JSON.stringify(targetOrigin || "null");
  return `<!DOCTYPE html>
<html><head><title>PrivateGPT</title></head>
<body>
<p>${visible}</p>
<script>
  try { window.opener && window.opener.postMessage(${payload}, ${origin}); } catch (e) {}
  setTimeout(function () { window.close(); }, 400);
</script>
</body></html>`;
}

async function updateProviderConfigs(provider, patch) {
  const rows = await KnowledgeSource.where({ provider });
  for (const row of rows) {
    const config = KnowledgeSource.decryptConfig(row) || {};
    await KnowledgeSource.update(row.id, {
      config: { ...config, ...patch },
    });
  }
}

function toPublicSource(record, workspacesById = {}) {
  const config = KnowledgeSource.decryptConfig(record) || {};
  const workspace = workspacesById[record.workspaceId];
  return {
    id: record.id,
    provider: record.provider,
    workspaceId: record.workspaceId,
    workspaceName: workspace?.name || null,
    workspaceSlug: workspace?.slug || null,
    display_name: record.display_name,
    remote_id: record.remote_id,
    watch_enabled: record.watch_enabled,
    last_synced_at: record.last_synced_at,
    last_error: record.last_error,
    createdAt: record.createdAt,
    pageId: config.pageId || null,
    path: config.path || null,
    account_email: config.account_email || null,
  };
}

async function resolveWorkspace({ workspaceId, workspaceSlug }) {
  if (workspaceId) return Workspace.get({ id: Number(workspaceId) });
  if (workspaceSlug) return Workspace.get({ slug: String(workspaceSlug) });
  return null;
}

async function workspacesById() {
  const rows = await Workspace.where();
  return Object.fromEntries(rows.map((ws) => [ws.id, ws]));
}

async function dropboxConnection() {
  const record = await ConnectedFileSource.get({ provider: "dropbox" });
  if (!record) return { record: null, tokens: null };
  return { record, tokens: ConnectedFileSource.tokens(record) };
}

function knowledgeSourcesEndpoints(app) {
  if (!app) return;

  app.get(
    "/knowledge-sources",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (_request, response) => {
      try {
        const [sources, notionToken, dropboxOauth, dropbox, workspaces] =
          await Promise.all([
            KnowledgeSource.where(),
            getNotionToken(),
            getDropboxOAuthConfig(),
            dropboxConnection(),
            Workspace.where(),
          ]);
        const byId = Object.fromEntries(workspaces.map((ws) => [ws.id, ws]));
        response.status(200).json({
          notion: { connected: Boolean(notionToken) },
          dropbox: {
            ...publicDropboxConfig(dropboxOauth),
            connected: Boolean(dropbox.tokens?.accessToken),
            accountEmail: dropbox.record?.account_email || null,
            accountName: dropbox.record?.account_name || null,
          },
          sources: sources.map((row) => toPublicSource(row, byId)),
          workspaces: workspaces.map((ws) => ({
            id: ws.id,
            name: ws.name,
            slug: ws.slug,
          })),
        });
      } catch (e) {
        console.error(e);
        response.status(500).json({ error: e.message });
      }
    }
  );

  app.post(
    "/knowledge-sources/notion/token",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const { token } = reqBody(request) || {};
        if (!token)
          return response.status(400).json({
            success: false,
            error: "Notion integration token is required.",
          });
        await verifyToken(token);
        await saveNotionToken(token);
        await updateProviderConfigs("notion", { token });
        response.status(200).json({ success: true, connected: true });
      } catch (e) {
        console.error(e);
        response.status(400).json({
          success: false,
          error: e.message || "Could not verify Notion token.",
        });
      }
    }
  );

  app.get(
    "/knowledge-sources/notion/pages",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const token = await getNotionToken();
        if (!token)
          return response.status(400).json({
            error:
              "Notion is not connected. Save an internal integration token first.",
          });
        const parent = request.query.parent || null;
        const adapter = createNotionAdapter({ token, pageId: parent || null });
        const listed = await adapter.list({
          folderId: parent || null,
          cursor: request.query.cursor || null,
        });
        response
          .status(200)
          .json({ items: listed.items, cursor: listed.cursor });
      } catch (e) {
        console.error(e);
        response.status(500).json({ error: e.message, items: [] });
      }
    }
  );

  app.post(
    "/knowledge-sources/notion/watch",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const body = reqBody(request) || {};
        const pageId = body.pageId || body.remote_id;
        if (!pageId)
          return response
            .status(400)
            .json({ success: false, error: "Select a Notion page." });
        const workspace = await resolveWorkspace(body);
        if (!workspace)
          return response
            .status(400)
            .json({ success: false, error: "Workspace is required." });
        const token = body.token || (await getNotionToken());
        if (!token)
          return response.status(400).json({
            success: false,
            error:
              "Notion is not connected. Save an internal integration token first.",
          });

        const adapter = createNotionAdapter({ token, pageId });
        let title = body.display_name;
        if (!title) {
          try {
            const listed = await adapter.list({ folderId: pageId });
            title = listed.items[0]?.title;
          } catch {
            title = null;
          }
        }

        const source = await KnowledgeSource.create({
          provider: "notion",
          workspaceId: workspace.id,
          display_name: title || `Notion ${pageId}`,
          remote_id: pageId,
          watch_enabled: true,
          config: { token, pageId },
        });
        if (!source)
          return response.status(500).json({
            success: false,
            error: "Could not create knowledge source.",
          });

        const byId = await workspacesById();
        response.status(200).json({
          success: true,
          source: toPublicSource(source, byId),
        });
      } catch (e) {
        console.error(e);
        response.status(500).json({ success: false, error: e.message });
      }
    }
  );

  app.get(
    "/knowledge-sources/dropbox/oauth-config",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (_request, response) => {
      try {
        const config = publicDropboxConfig(await getDropboxOAuthConfig());
        response.status(200).json({ config });
      } catch (e) {
        console.error(e);
        response.status(500).json({ error: e.message });
      }
    }
  );

  app.post(
    "/knowledge-sources/dropbox/oauth-config",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const incoming = reqBody(request) || {};
        const saved = await saveDropboxOAuthConfig(incoming);
        response.status(200).json({
          success: true,
          config: publicDropboxConfig(saved),
        });
      } catch (e) {
        console.error(e);
        response.status(500).json({ success: false, error: e.message });
      }
    }
  );

  app.get(
    "/knowledge-sources/dropbox/auth-url",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const config = await getDropboxOAuthConfig();
        const state = crypto.randomBytes(16).toString("hex");
        pendingOAuth.set(state, {
          provider: "dropbox",
          createdAt: Date.now(),
          openerOrigin: openerOrigin(request),
        });
        const result = dropboxAuthUrl(
          getRedirectUri(request, "dropbox"),
          state,
          { clientId: config.clientId }
        );
        if (!result.success)
          return response.status(400).json({ error: result.error });
        response.status(200).json({
          url: result.url,
          origin: callbackOrigin(request, "dropbox"),
        });
      } catch (e) {
        console.error(e);
        response.status(500).json({ error: e.message });
      }
    }
  );

  app.get("/knowledge-sources/dropbox/callback", async (request, response) => {
    const { code, state, error, error_description } = request.query;
    const pending = pendingOAuth.get(state);
    pendingOAuth.delete(state);
    const html = (opts) =>
      popupHtml({
        ...opts,
        provider: "dropbox",
        targetOrigin: pending?.openerOrigin || null,
      });

    if (error)
      return response.send(
        html({ success: false, error: error_description || error })
      );

    if (!pending || pending.provider !== "dropbox")
      return response.send(
        html({ success: false, error: "Invalid or expired OAuth state." })
      );
    if (Date.now() - pending.createdAt > OAUTH_TTL_MS)
      return response.send(html({ success: false, error: "OAuth timed out." }));

    try {
      const config = await getDropboxOAuthConfig();
      const result = await dropboxExchangeCode(
        code,
        getRedirectUri(request, "dropbox"),
        { clientId: config.clientId, clientSecret: config.clientSecret }
      );
      if (!result.success)
        return response.send(html({ success: false, error: result.error }));

      const tokenExpiresAt = result.expires_in
        ? new Date(Date.now() + (result.expires_in - 60) * 1000)
        : null;
      await ConnectedFileSource.upsertByProvider("dropbox", {
        access_token: result.access_token,
        refresh_token: result.refresh_token,
        token_expires_at: tokenExpiresAt,
        account_email: result.account_email,
        account_name: result.account_name,
      });
      const configPatch = {
        access_token: result.access_token,
        token_expires_at: tokenExpiresAt,
        account_email: result.account_email,
      };
      if (result.refresh_token)
        configPatch.refresh_token = result.refresh_token;
      await updateProviderConfigs("dropbox", configPatch);
      return response.send(html({ success: true, error: null }));
    } catch (e) {
      console.error(e);
      return response.send(html({ success: false, error: e.message }));
    }
  });

  app.get(
    "/knowledge-sources/dropbox/folders",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const { record, tokens } = await dropboxConnection();
        if (!tokens?.accessToken)
          return response.status(400).json({
            error: "Dropbox is not connected. Complete OAuth first.",
            items: [],
          });
        const oauth = await getDropboxOAuthConfig();
        const adapter = createDropboxAdapter({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt,
          clientId: oauth.clientId,
          clientSecret: oauth.clientSecret,
          onTokens: async (next) => {
            await ConnectedFileSource.upsertByProvider("dropbox", {
              ...next,
              account_email: record.account_email,
              account_name: record.account_name,
            });
          },
        });
        const path = request.query.path || "";
        const listed = await adapter.listChildren(path);
        response.status(200).json(listed);
      } catch (e) {
        console.error(e);
        response.status(500).json({ error: e.message, items: [] });
      }
    }
  );

  app.post(
    "/knowledge-sources/dropbox/watch",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const body = reqBody(request) || {};
        const path = body.path || body.remote_id || "";
        const workspace = await resolveWorkspace(body);
        if (!workspace)
          return response
            .status(400)
            .json({ success: false, error: "Workspace is required." });

        const { record, tokens } = await dropboxConnection();
        if (!tokens?.accessToken)
          return response.status(400).json({
            success: false,
            error: "Dropbox is not connected. Complete OAuth first.",
          });
        const oauth = await getDropboxOAuthConfig();
        const display =
          body.display_name ||
          (path ? path.split("/").filter(Boolean).pop() : "Dropbox");

        const source = await KnowledgeSource.create({
          provider: "dropbox",
          workspaceId: workspace.id,
          display_name: display || "Dropbox",
          remote_id: path || "/",
          watch_enabled: true,
          config: {
            path: path || "",
            access_token: tokens.accessToken,
            refresh_token: tokens.refreshToken,
            token_expires_at: tokens.expiresAt || null,
            account_email: record.account_email,
            clientId: oauth.clientId,
            clientSecret: oauth.clientSecret,
          },
        });
        if (!source)
          return response.status(500).json({
            success: false,
            error: "Could not create knowledge source.",
          });

        const byId = await workspacesById();
        response.status(200).json({
          success: true,
          source: toPublicSource(source, byId),
        });
      } catch (e) {
        console.error(e);
        response.status(500).json({ success: false, error: e.message });
      }
    }
  );

  app.delete(
    "/knowledge-sources/:id",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const ok = await KnowledgeSource.delete(request.params.id);
        response.status(200).json({ success: ok });
      } catch (e) {
        console.error(e);
        response.status(500).json({ success: false, error: e.message });
      }
    }
  );
}

module.exports = { knowledgeSourcesEndpoints };
