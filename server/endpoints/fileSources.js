const crypto = require("crypto");
const { reqBody } = require("../utils/http");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { ConnectedFileSource } = require("../models/connectedFileSource");
const { SystemSettings } = require("../models/systemSettings");
const { KnowledgeSource } = require("../models/knowledgeSource");
const { Workspace } = require("../models/workspace");
const {
  getFileSourceOAuthConfig,
  publicConfig,
  looksMasked,
} = require("../utils/fileSources/credentials");
const { OneDriveSource } = require("../utils/fileSources/onedrive");
const { GoogleDriveSource } = require("../utils/fileSources/googleDrive");
const { SharePointSource } = require("../utils/fileSources/sharepoint");
const { TeamsFilesSource } = require("../utils/fileSources/teamsFiles");
const { indexRemoteFiles } = require("../utils/fileSources/indexFiles");

const pendingOAuth = new Map();
const OAUTH_TTL_MS = 10 * 60 * 1000;

const ADAPTERS = {
  onedrive: OneDriveSource,
  "google-drive": GoogleDriveSource,
  sharepoint: SharePointSource,
  "teams-files": TeamsFilesSource,
};

const WATCHABLE_PROVIDERS = [
  "google-drive",
  "onedrive",
  "sharepoint",
  "teams-files",
];

function getRedirectUri(request, provider) {
  const protocol = request.headers["x-forwarded-proto"] || request.protocol;
  const host = request.headers["x-forwarded-host"] || request.get("host");
  return `${protocol}://${host}/api/file-sources/${provider}/callback`;
}

function popupHtml({ success, error, provider }) {
  const payload = JSON.stringify({
    type: "file-source-oauth",
    success,
    error: error || null,
    provider,
  });
  return `<!DOCTYPE html>
<html><head><title>PrivateGPT</title></head>
<body>
<p>${success ? "Connected. You can close this window." : `Could not connect: ${error || "unknown error"}`}</p>
<script>
  try { window.opener && window.opener.postMessage(${payload}, "*"); } catch (e) {}
  setTimeout(function () { window.close(); }, 400);
</script>
</body></html>`;
}

function fileSourcesEndpoints(app) {
  if (!app) return;

  app.get(
    "/file-sources",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (_request, response) => {
      try {
        const records = await ConnectedFileSource.where();
        const config = publicConfig(await getFileSourceOAuthConfig());
        const byProvider = Object.fromEntries(
          records.map((row) => [
            row.provider,
            ConnectedFileSource.toPublic(row),
          ])
        );
        const watches = await KnowledgeSource.where({
          provider: { in: WATCHABLE_PROVIDERS },
        });
        response.status(200).json({
          sources: {
            local: { provider: "local", connected: true },
            onedrive: byProvider.onedrive || {
              provider: "onedrive",
              connected: false,
            },
            "google-drive": byProvider["google-drive"] || {
              provider: "google-drive",
              connected: false,
            },
            sharepoint: byProvider.sharepoint || {
              provider: "sharepoint",
              connected: false,
            },
            "teams-files": byProvider["teams-files"] || {
              provider: "teams-files",
              connected: false,
            },
          },
          oauth: config,
          knowledgeSources: watches.map((row) => ({
            id: row.id,
            provider: row.provider,
            workspaceId: row.workspaceId,
            displayName: row.display_name,
            remoteId: row.remote_id,
            watchEnabled: row.watch_enabled,
            lastSyncedAt: row.last_synced_at,
            lastError: row.last_error,
          })),
        });
      } catch (e) {
        console.error(e);
        response.status(500).json({ error: e.message });
      }
    }
  );

  app.get(
    "/file-sources/oauth-config",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (_request, response) => {
      try {
        const config = publicConfig(await getFileSourceOAuthConfig());
        response.status(200).json({ config });
      } catch (e) {
        console.error(e);
        response.status(500).json({ error: e.message });
      }
    }
  );

  app.post(
    "/file-sources/oauth-config",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const incoming = reqBody(request) || {};
        const existing = await getFileSourceOAuthConfig();
        const next = {
          onedrive: {
            clientId: incoming.onedrive?.clientId ?? existing.onedrive.clientId,
            clientSecret: looksMasked(incoming.onedrive?.clientSecret)
              ? existing.onedrive.clientSecret
              : (incoming.onedrive?.clientSecret ??
                existing.onedrive.clientSecret),
          },
          google: {
            clientId: incoming.google?.clientId ?? existing.google.clientId,
            clientSecret: looksMasked(incoming.google?.clientSecret)
              ? existing.google.clientSecret
              : (incoming.google?.clientSecret ?? existing.google.clientSecret),
          },
        };
        await SystemSettings.updateSettings({
          file_source_oauth_config: JSON.stringify(next),
        });
        response.status(200).json({
          success: true,
          config: publicConfig(next),
        });
      } catch (e) {
        console.error(e);
        response.status(500).json({ success: false, error: e.message });
      }
    }
  );

  app.get(
    "/file-sources/:provider/auth-url",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request, response) => {
      try {
        const { provider } = request.params;
        const adapter = ADAPTERS[provider];
        if (!adapter)
          return response.status(400).json({ error: "Unknown provider" });

        const state = crypto.randomBytes(16).toString("hex");
        pendingOAuth.set(state, { provider, createdAt: Date.now() });
        const redirectUri = getRedirectUri(request, provider);
        const result = await adapter.authUrl(redirectUri, state);
        if (!result.success)
          return response.status(400).json({ error: result.error });
        response.status(200).json({ url: result.url });
      } catch (e) {
        console.error(e);
        response.status(500).json({ error: e.message });
      }
    }
  );

  app.get("/file-sources/:provider/callback", async (request, response) => {
    const { provider } = request.params;
    const { code, state, error, error_description } = request.query;
    const adapter = ADAPTERS[provider];
    if (!adapter)
      return response
        .status(400)
        .send(
          popupHtml({ success: false, error: "Unknown provider", provider })
        );

    if (error)
      return response.send(
        popupHtml({
          success: false,
          error: error_description || error,
          provider,
        })
      );

    const pending = pendingOAuth.get(state);
    pendingOAuth.delete(state);
    if (!pending || pending.provider !== provider)
      return response.send(
        popupHtml({
          success: false,
          error: "Invalid or expired OAuth state.",
          provider,
        })
      );
    if (Date.now() - pending.createdAt > OAUTH_TTL_MS)
      return response.send(
        popupHtml({ success: false, error: "OAuth timed out.", provider })
      );

    try {
      const redirectUri = getRedirectUri(request, provider);
      const result = await adapter.exchangeCode(code, redirectUri);
      return response.send(
        popupHtml({
          success: !!result.success,
          error: result.error,
          provider,
        })
      );
    } catch (e) {
      console.error(e);
      return response.send(
        popupHtml({ success: false, error: e.message, provider })
      );
    }
  });

  app.get(
    "/file-sources/:id/children",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request, response) => {
      try {
        const record = await ConnectedFileSource.get({
          id: Number(request.params.id),
        });
        if (!record)
          return response.status(404).json({ error: "Not connected" });
        const adapter = ADAPTERS[record.provider];
        const parent = request.query.parent || "root";
        const data = await adapter.listChildren(record, parent);
        response.status(200).json(data);
      } catch (e) {
        console.error(e);
        response.status(500).json({ error: e.message });
      }
    }
  );

  app.get(
    "/file-sources/:id/search",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request, response) => {
      try {
        const record = await ConnectedFileSource.get({
          id: Number(request.params.id),
        });
        if (!record)
          return response.status(404).json({ error: "Not connected" });
        const q = String(request.query.q || "").trim();
        if (!q) return response.status(200).json({ items: [] });
        const adapter = ADAPTERS[record.provider];
        const data = await adapter.search(record, q);
        response.status(200).json(data);
      } catch (e) {
        console.error(e);
        response.status(500).json({ error: e.message });
      }
    }
  );

  app.post(
    "/file-sources/:id/index",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request, response) => {
      try {
        const record = await ConnectedFileSource.get({
          id: Number(request.params.id),
        });
        if (!record)
          return response.status(404).json({ error: "Not connected" });
        const { fileIds = [], workspaceSlug } = reqBody(request) || {};
        if (!workspaceSlug)
          return response
            .status(400)
            .json({ error: "workspaceSlug is required" });
        if (!Array.isArray(fileIds) || fileIds.length === 0)
          return response
            .status(400)
            .json({ error: "Select at least one file" });

        const adapter = ADAPTERS[record.provider];
        const result = await indexRemoteFiles({
          adapter,
          record,
          fileIds,
          workspaceSlug,
        });

        if (result.folders?.length) {
          const workspace = await Workspace.get({ slug: workspaceSlug });
          if (workspace) {
            for (const folder of result.folders) {
              let sync_cursor = null;
              try {
                if (record.provider === "google-drive") {
                  sync_cursor =
                    await GoogleDriveSource.getStartPageToken(record);
                } else if (record.provider === "onedrive") {
                  sync_cursor = await OneDriveSource.getDeltaLink(
                    record,
                    folder.id
                  );
                } else if (record.provider === "sharepoint") {
                  sync_cursor = await SharePointSource.getDeltaLink(
                    record,
                    folder
                  );
                } else if (record.provider === "teams-files") {
                  sync_cursor = await TeamsFilesSource.getDeltaLink(
                    record,
                    folder
                  );
                }
              } catch (e) {
                console.error(e);
              }
              await KnowledgeSource.upsertByRemote({
                workspaceId: workspace.id,
                provider: record.provider,
                remote_id: folder.id,
                display_name: folder.name,
                watch_enabled: true,
                sync_cursor,
                config: {
                  connectedFileSourceId: record.id,
                  folderIds: [folder.id, ...(folder.folderIds || [])],
                  driveId: folder.driveId || null,
                  itemId: folder.itemId || null,
                  siteId: folder.siteId || null,
                  teamId: folder.teamId || null,
                  channelId: folder.channelId || null,
                },
              });
            }
          }
        }

        response.status(200).json({ success: true, ...result });
      } catch (e) {
        console.error(e);
        response.status(500).json({ success: false, error: e.message });
      }
    }
  );

  app.delete(
    "/file-sources/:id",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request, response) => {
      try {
        const ok = await ConnectedFileSource.delete(request.params.id);
        response.status(200).json({ success: ok });
      } catch (e) {
        console.error(e);
        response.status(500).json({ success: false, error: e.message });
      }
    }
  );
}

module.exports = { fileSourcesEndpoints };
