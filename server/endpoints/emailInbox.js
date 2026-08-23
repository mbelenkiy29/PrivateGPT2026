const { reqBody } = require("../utils/http");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const { KnowledgeSource } = require("../models/knowledgeSource");
const { Workspace } = require("../models/workspace");
require("../utils/knowledgeSources");

const EMAIL_PROVIDERS = ["imap", "gmail-mail", "outlook-mail"];

function publicConfig(provider, config = {}) {
  if (provider === "imap") {
    return {
      host: config.host || "",
      port: config.port || 993,
      user: config.user || "",
      tls: config.tls !== false,
      includeSent: !!config.includeSent,
      hasPassword: !!config.password,
    };
  }
  return {
    useConnected: config.useConnected !== false,
    includeSent: !!config.includeSent,
  };
}

function publicSource(record) {
  const config = KnowledgeSource.decryptConfig(record) || {};
  return {
    id: record.id,
    provider: record.provider,
    workspaceId: record.workspaceId,
    display_name: record.display_name,
    watch_enabled: record.watch_enabled,
    last_synced_at: record.last_synced_at,
    last_error: record.last_error,
    createdAt: record.createdAt,
    config: publicConfig(record.provider, config),
  };
}

async function gmailConnected() {
  try {
    const {
      GmailBridge,
    } = require("../utils/agents/aibitat/plugins/gmail/lib");
    return await GmailBridge.isToolAvailable();
  } catch {
    return false;
  }
}

async function outlookConnected() {
  try {
    const {
      OutlookBridge,
    } = require("../utils/agents/aibitat/plugins/outlook/lib");
    return await OutlookBridge.isToolAvailable();
  } catch {
    return false;
  }
}

function emailInboxEndpoints(app) {
  if (!app) return;

  app.get(
    "/admin/email-inbox",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (_request, response) => {
      try {
        const [records, workspaces, gmail, outlook] = await Promise.all([
          KnowledgeSource.where({ provider: { in: EMAIL_PROVIDERS } }),
          Workspace.where(),
          gmailConnected(),
          outlookConnected(),
        ]);
        response.status(200).json({
          sources: records.map(publicSource),
          workspaces: (workspaces || []).map((ws) => ({
            id: ws.id,
            name: ws.name,
            slug: ws.slug,
          })),
          gmail: { connected: !!gmail },
          outlook: { connected: !!outlook },
        });
      } catch (e) {
        console.error(e);
        response.status(500).json({ error: e.message });
      }
    }
  );

  app.post(
    "/admin/email-inbox/imap",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const body = reqBody(request) || {};
        const workspaceId = Number(body.workspaceId);
        const host = String(body.host || "").trim();
        const user = String(body.user || "").trim();
        const password = String(body.password || "");
        if (!workspaceId) {
          return response
            .status(400)
            .json({ success: false, error: "workspaceId is required." });
        }
        if (!host || !user || !password) {
          return response.status(400).json({
            success: false,
            error: "IMAP host, username, and password are required.",
          });
        }
        const workspace = await Workspace.get({ id: workspaceId });
        if (!workspace) {
          return response
            .status(404)
            .json({ success: false, error: "Workspace not found." });
        }

        const source = await KnowledgeSource.create({
          provider: "imap",
          workspaceId,
          display_name:
            String(body.display_name || "").trim() || `IMAP (${user})`,
          remote_id: `${host}:${user}`,
          watch_enabled: body.watch_enabled !== false,
          config: {
            host,
            port: Number(body.port || 993),
            user,
            password,
            tls: body.tls !== false,
            includeSent: !!body.includeSent,
          },
        });
        if (!source) {
          return response.status(500).json({
            success: false,
            error: "Could not save IMAP knowledge source.",
          });
        }
        response
          .status(200)
          .json({ success: true, source: publicSource(source) });
      } catch (e) {
        console.error(e);
        response.status(500).json({ success: false, error: e.message });
      }
    }
  );

  app.post(
    "/admin/email-inbox/gmail-mail",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const body = reqBody(request) || {};
        const workspaceId = Number(body.workspaceId);
        if (!workspaceId) {
          return response
            .status(400)
            .json({ success: false, error: "workspaceId is required." });
        }
        const connected = await gmailConnected();
        if (!connected) {
          return response.status(400).json({
            success: false,
            error:
              "Gmail is not connected. Configure Gmail under Agent Skills first.",
          });
        }
        const workspace = await Workspace.get({ id: workspaceId });
        if (!workspace) {
          return response
            .status(404)
            .json({ success: false, error: "Workspace not found." });
        }
        const source = await KnowledgeSource.create({
          provider: "gmail-mail",
          workspaceId,
          display_name: String(body.display_name || "").trim() || "Gmail inbox",
          remote_id: "gmail-connected",
          watch_enabled: body.watch_enabled !== false,
          config: {
            useConnected: true,
            includeSent: !!body.includeSent,
          },
        });
        if (!source) {
          return response.status(500).json({
            success: false,
            error: "Could not save Gmail knowledge source.",
          });
        }
        response
          .status(200)
          .json({ success: true, source: publicSource(source) });
      } catch (e) {
        console.error(e);
        response.status(500).json({ success: false, error: e.message });
      }
    }
  );

  app.post(
    "/admin/email-inbox/outlook-mail",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const body = reqBody(request) || {};
        const workspaceId = Number(body.workspaceId);
        if (!workspaceId) {
          return response
            .status(400)
            .json({ success: false, error: "workspaceId is required." });
        }
        const connected = await outlookConnected();
        if (!connected) {
          return response.status(400).json({
            success: false,
            error:
              "Outlook is not connected. Configure Outlook under Agent Skills first.",
          });
        }
        const workspace = await Workspace.get({ id: workspaceId });
        if (!workspace) {
          return response
            .status(404)
            .json({ success: false, error: "Workspace not found." });
        }
        const source = await KnowledgeSource.create({
          provider: "outlook-mail",
          workspaceId,
          display_name:
            String(body.display_name || "").trim() || "Outlook inbox",
          remote_id: "outlook-connected",
          watch_enabled: body.watch_enabled !== false,
          config: {
            useConnected: true,
            includeSent: !!body.includeSent,
          },
        });
        if (!source) {
          return response.status(500).json({
            success: false,
            error: "Could not save Outlook knowledge source.",
          });
        }
        response
          .status(200)
          .json({ success: true, source: publicSource(source) });
      } catch (e) {
        console.error(e);
        response.status(500).json({ success: false, error: e.message });
      }
    }
  );

  app.delete(
    "/admin/email-inbox/:id",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const id = Number(request.params.id);
        const existing = await KnowledgeSource.get({ id });
        if (!existing || !EMAIL_PROVIDERS.includes(existing.provider)) {
          return response.status(404).json({
            success: false,
            error: "Email knowledge source not found.",
          });
        }
        const ok = await KnowledgeSource.delete(id);
        response.status(200).json({ success: !!ok });
      } catch (e) {
        console.error(e);
        response.status(500).json({ success: false, error: e.message });
      }
    }
  );
}

module.exports = { emailInboxEndpoints };
