const crypto = require("crypto");
const { reqBody } = require("../utils/http");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { KnowledgeSource } = require("../models/knowledgeSource");
const { ConnectedFileSource } = require("../models/connectedFileSource");
const { Workspace } = require("../models/workspace");
const { Document } = require("../models/documents");
const { CollectorApi } = require("../utils/collectorApi");
const {
  PROVIDER,
  createSlackAdapter,
  authUrl,
  exchangeCode,
  listChannels,
  getSlackOAuthConfig,
  publicSlackOAuthConfig,
  saveSlackOAuthConfig,
  getSlackConnection,
  tokenConfigFromConnection,
  clearConnectionMeta,
  PAGE_SIZE,
} = require("../utils/knowledgeSources/adapters/slack");

const pendingOAuth = new Map();
const OAUTH_TTL_MS = 10 * 60 * 1000;
const MAX_INGEST = 200;

function getRedirectUri(request) {
  const protocol = request.headers["x-forwarded-proto"] || request.protocol;
  const host = request.headers["x-forwarded-host"] || request.get("host");
  return `${protocol}://${host}/api/slack/callback`;
}

function popupHtml({ success, error }) {
  const payload = JSON.stringify({
    type: "slack-oauth",
    success,
    error: error || null,
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

function publicSource(record, workspacesById = {}) {
  if (!record) return null;
  const workspace = workspacesById[record.workspaceId] || {};
  return {
    id: record.id,
    provider: record.provider,
    displayName: record.display_name,
    remoteId: record.remote_id,
    workspaceId: record.workspaceId,
    workspaceName: workspace.name || null,
    workspaceSlug: workspace.slug || null,
    watchEnabled: record.watch_enabled,
    lastSyncedAt: record.last_synced_at,
    lastError: record.last_error,
    createdAt: record.createdAt,
  };
}

function slackErrorMessage(error) {
  if (!error) return "Ingest failed";
  if (error.slackError) return error.slackError;
  return error.message || "Ingest failed";
}

function mergeThreadIds(source, items = []) {
  const existing = KnowledgeSource.decryptConfig(source) || {};
  const ids = [
    ...(existing.thread_ids || []),
    ...items.map((item) => item.thread_ts || item.ts),
  ]
    .map(String)
    .filter(Boolean);
  return {
    ...existing,
    thread_ids: [...new Set(ids)].slice(-500),
  };
}

async function ingestChannel({ source, workspace, bound }) {
  let listed;
  try {
    listed = await bound.list({
      source,
      folderId: source.remote_id,
    });
  } catch (e) {
    const message = slackErrorMessage(e);
    await KnowledgeSource.update(source.id, { last_error: message });
    throw e;
  }
  const items = (listed.items || []).slice(0, MAX_INGEST);
  const config = mergeThreadIds(source, items);
  if (items.length === 0) {
    await KnowledgeSource.update(source.id, {
      config,
      sync_cursor: listed.cursor || source.sync_cursor,
      last_synced_at: new Date(),
      last_error: null,
    });
    return { indexed: 0, failed: 0 };
  }

  const collector = new CollectorApi();
  if (!(await collector.online())) {
    await KnowledgeSource.update(source.id, {
      config,
      last_error: "Collector unavailable; watch enabled for later sync.",
    });
    return { indexed: 0, failed: 0 };
  }

  const locations = [];
  let failed = 0;
  let lastError = null;
  let newest = source.sync_cursor || null;

  for (const item of items) {
    try {
      const file = await bound.download(item);
      const markdown = file.buffer.toString("utf8");
      const processed = await collector.processRawText(markdown, {
        title: file.name,
        docAuthor: "slack",
        description: `Slack channel ${source.remote_id}`,
        docSource: "slack",
        chunkSource: bound.toChunkSource(item),
      });
      if (!processed?.success || !processed.documents?.length) {
        failed += 1;
        lastError = processed?.reason || lastError || "Ingest failed";
        continue;
      }
      for (const doc of processed.documents) {
        if (doc.location) locations.push(doc.location);
      }
      const ts = item.thread_ts || item.ts;
      if (ts && (!newest || Number(ts) > Number(newest))) newest = ts;
    } catch (e) {
      failed += 1;
      lastError = slackErrorMessage(e);
    }
  }

  if (locations.length > 0) {
    await Document.addDocuments(workspace, locations);
  }

  await KnowledgeSource.update(source.id, {
    config,
    sync_cursor: newest,
    last_synced_at: new Date(),
    last_error:
      failed > 0 && locations.length === 0
        ? lastError || "Ingest failed"
        : null,
  });

  return { indexed: locations.length, failed };
}

function slackEndpoints(app) {
  if (!app) return;

  app.get(
    "/slack/oauth-config",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const config = publicSlackOAuthConfig(await getSlackOAuthConfig());
        response.status(200).json({
          config,
          redirectUri: getRedirectUri(request),
        });
      } catch (e) {
        console.error(e);
        response.status(500).json({ error: e.message });
      }
    }
  );

  app.post(
    "/slack/oauth-config",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const incoming = reqBody(request) || {};
        const next = await saveSlackOAuthConfig({
          clientId: incoming.clientId,
          clientSecret: incoming.clientSecret,
        });
        response.status(200).json({
          success: true,
          config: publicSlackOAuthConfig(next),
        });
      } catch (e) {
        console.error(e);
        response.status(500).json({ success: false, error: e.message });
      }
    }
  );

  app.get(
    "/slack/auth-url",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const state = crypto.randomBytes(16).toString("hex");
        pendingOAuth.set(state, { createdAt: Date.now() });
        const result = await authUrl(getRedirectUri(request), state);
        if (!result.success)
          return response.status(400).json({ error: result.error });
        response.status(200).json({ url: result.url });
      } catch (e) {
        console.error(e);
        response.status(500).json({ error: e.message });
      }
    }
  );

  app.get("/slack/callback", async (request, response) => {
    const { code, state, error, error_description } = request.query;
    if (error)
      return response.send(
        popupHtml({ success: false, error: error_description || error })
      );

    const pending = pendingOAuth.get(state);
    pendingOAuth.delete(state);
    if (!pending)
      return response.send(
        popupHtml({ success: false, error: "Invalid or expired OAuth state." })
      );
    if (Date.now() - pending.createdAt > OAUTH_TTL_MS)
      return response.send(
        popupHtml({ success: false, error: "OAuth timed out." })
      );

    try {
      const result = await exchangeCode(code, getRedirectUri(request));
      return response.send(
        popupHtml({ success: !!result.success, error: result.error })
      );
    } catch (e) {
      console.error(e);
      return response.send(popupHtml({ success: false, error: e.message }));
    }
  });

  app.get(
    "/slack/status",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const [oauth, connection, sources, workspaces] = await Promise.all([
          getSlackOAuthConfig(),
          getSlackConnection(),
          KnowledgeSource.where({ provider: PROVIDER }),
          Workspace.where(),
        ]);
        const workspacesById = Object.fromEntries(
          workspaces.map((ws) => [ws.id, ws])
        );
        response.status(200).json({
          oauth: publicSlackOAuthConfig(oauth),
          redirectUri: getRedirectUri(request),
          connected: Boolean(connection),
          team: connection
            ? { id: connection.account_email, name: connection.account_name }
            : null,
          sources: sources.map((row) => publicSource(row, workspacesById)),
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

  app.get(
    "/slack/channels",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (_request, response) => {
      try {
        const data = await listChannels();
        response.status(200).json(data);
      } catch (e) {
        console.error(e);
        const status = /not connected/i.test(e.message) ? 400 : 500;
        response.status(status).json({ error: e.message });
      }
    }
  );

  app.post(
    "/slack/connect",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const {
          workspaceSlug,
          workspaceId,
          channels: selected = [],
        } = reqBody(request) || {};
        if (!Array.isArray(selected) || selected.length === 0)
          return response
            .status(400)
            .json({ success: false, error: "Select at least one channel." });

        const workspace = workspaceSlug
          ? await Workspace.get({ slug: String(workspaceSlug) })
          : await Workspace.get({ id: Number(workspaceId) });
        if (!workspace)
          return response
            .status(400)
            .json({ success: false, error: "Workspace not found." });

        const connection = await getSlackConnection();
        const tokenConfig = await tokenConfigFromConnection(connection);
        if (!tokenConfig)
          return response
            .status(400)
            .json({ success: false, error: "Slack is not connected." });

        const existing = await KnowledgeSource.where({
          provider: PROVIDER,
          workspaceId: workspace.id,
        });
        const existingIds = new Set(existing.map((row) => row.remote_id));
        const created = [];
        const skipped = [];
        const ingest = [];

        for (const channel of selected.slice(0, PAGE_SIZE)) {
          const channelId = channel.id || channel.remoteId;
          if (!channelId) continue;
          if (existingIds.has(channelId)) {
            skipped.push(channelId);
            continue;
          }
          const displayName = channel.name
            ? `#${String(channel.name).replace(/^#/, "")}`
            : channelId;
          const source = await KnowledgeSource.create({
            provider: PROVIDER,
            workspaceId: workspace.id,
            display_name: displayName,
            remote_id: channelId,
            watch_enabled: true,
            config: {
              ...tokenConfig,
              channel_id: channelId,
              channel_name: channel.name || displayName,
              is_private: Boolean(channel.isPrivate),
            },
          });
          if (!source) {
            skipped.push(channelId);
            continue;
          }
          created.push(source);
          existingIds.add(channelId);

          const bound = createSlackAdapter({
            accessToken: tokenConfig.access_token,
            botToken: tokenConfig.bot_token,
            userToken: tokenConfig.user_token,
            channelId,
            source,
          });
          try {
            ingest.push(await ingestChannel({ source, workspace, bound }));
          } catch (e) {
            await KnowledgeSource.update(source.id, {
              last_error: slackErrorMessage(e),
            });
            ingest.push({
              indexed: 0,
              failed: 1,
              error: slackErrorMessage(e),
            });
          }
        }

        response.status(200).json({
          success: true,
          created: created.map((row) =>
            publicSource(row, { [workspace.id]: workspace })
          ),
          skipped,
          ingest: {
            indexed: ingest.reduce((sum, row) => sum + (row.indexed || 0), 0),
            failed: ingest.reduce((sum, row) => sum + (row.failed || 0), 0),
          },
        });
      } catch (e) {
        console.error(e);
        response.status(500).json({ success: false, error: e.message });
      }
    }
  );

  app.delete(
    "/slack/sources/:id",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const source = await KnowledgeSource.get({
          id: Number(request.params.id),
          provider: PROVIDER,
        });
        if (!source)
          return response
            .status(404)
            .json({ success: false, error: "Not found" });
        const ok = await KnowledgeSource.delete(source.id);
        response.status(200).json({ success: ok });
      } catch (e) {
        console.error(e);
        response.status(500).json({ success: false, error: e.message });
      }
    }
  );

  app.delete(
    "/slack/disconnect",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (_request, response) => {
      try {
        const sources = await KnowledgeSource.where({ provider: PROVIDER });
        for (const source of sources) await KnowledgeSource.delete(source.id);
        const connection = await getSlackConnection();
        if (connection) await ConnectedFileSource.delete(connection.id);
        await clearConnectionMeta();
        response.status(200).json({ success: true });
      } catch (e) {
        console.error(e);
        response.status(500).json({ success: false, error: e.message });
      }
    }
  );
}

module.exports = { slackEndpoints };
