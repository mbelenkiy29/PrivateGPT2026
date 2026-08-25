const multer = require("multer");
const { reqBody } = require("../utils/http");
const { validatedRequest } = require("../utils/middleware/validatedRequest");
const {
  flexUserRoleValid,
  ROLES,
} = require("../utils/middleware/multiUserProtected");
const ImportedPlugin = require("../utils/agents/imported");
const { Workspace } = require("../models/workspace");
const { SystemSettings } = require("../models/systemSettings");
const {
  buildCatalog,
  snapshotGlobalEnabled,
  DEFAULT_SKILL_IDS,
} = require("../utils/agents/skillCatalog");
const {
  parseSkillOverrides,
  serializeSkillOverrides,
} = require("../utils/agents/skillOverrides");

const zipUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
}).single("file");

function skillsMarketplaceEndpoints(app) {
  if (!app) return;

  app.get(
    "/skills-marketplace/catalog",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request, response) => {
      try {
        const slug = String(request.query.workspace || "").trim();
        let workspace = null;
        if (slug) {
          workspace = await Workspace.get({ slug });
          if (!workspace)
            return response
              .status(404)
              .json({ success: false, error: "Workspace not found." });
        }
        const catalog = await buildCatalog({ workspace });
        response.status(200).json({ success: true, ...catalog });
      } catch (error) {
        console.error("skills-marketplace catalog:", error);
        response.status(500).json({
          success: false,
          error: error.message,
          items: [],
        });
      }
    }
  );

  app.post(
    "/skills-marketplace/create",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const spec = reqBody(request);
        const result = ImportedPlugin.createFromSpec(spec);
        if (!result.success)
          return response.status(400).json({ success: false, error: result.error });
        response.status(200).json({ success: true, plugin: result.plugin });
      } catch (error) {
        console.error("skills-marketplace create:", error);
        response.status(500).json({ success: false, error: error.message });
      }
    }
  );

  app.post(
    "/skills-marketplace/upload",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    (request, response) => {
      zipUpload(request, response, async (error) => {
        try {
          if (error)
            return response.status(400).json({
              success: false,
              error: error.message || "Upload failed.",
            });
          if (!request.file?.buffer)
            return response.status(400).json({
              success: false,
              error: "Zip file is required.",
            });
          const result = ImportedPlugin.importFromZipBuffer(request.file.buffer, {
            overwrite: Boolean(reqBody(request)?.overwrite),
          });
          if (!result.success)
            return response
              .status(400)
              .json({ success: false, error: result.error });
          response.status(200).json({ success: true, plugin: result.plugin });
        } catch (uploadError) {
          console.error("skills-marketplace upload:", uploadError);
          response
            .status(500)
            .json({ success: false, error: uploadError.message });
        }
      });
    }
  );

  app.post(
    "/skills-marketplace/toggle",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const { id, type, enabled } = reqBody(request);
        if (!id || !type)
          return response
            .status(400)
            .json({ success: false, error: "id and type are required." });

        const nextEnabled = Boolean(enabled);
        if (type === "imported") {
          const updated = ImportedPlugin.updateImportedPlugin(id, {
            active: nextEnabled,
          });
          if (!updated)
            return response
              .status(404)
              .json({ success: false, error: "Skill not found." });
          return response.status(200).json({ success: true, plugin: updated });
        }

        if (type === "flow") {
          const { AgentFlows } = require("../utils/agentFlows");
          const flow = AgentFlows.loadFlow(id);
          if (!flow)
            return response
              .status(404)
              .json({ success: false, error: "Flow not found." });
          flow.config.active = nextEnabled;
          const saved = AgentFlows.saveFlow(flow.name, flow.config, id);
          if (!saved?.success)
            return response.status(400).json({
              success: false,
              error: saved?.error || "Could not update flow.",
            });
          return response.status(200).json({ success: true });
        }

        if (type === "mcp") {
          const MCPCompatibilityLayer = require("../utils/MCP");
          const result = await new MCPCompatibilityLayer().toggleServerStatus(id);
          return response.status(200).json({
            success: result.success,
            error: result.error || null,
          });
        }

        if (type === "builtin") {
          const { safeJsonParse } = require("../utils/http");
          const disabled = new Set(
            safeJsonParse(
              await SystemSettings.getValueOrFallback(
                { label: "disabled_agent_skills" },
                "[]"
              ),
              []
            )
          );
          const enabledConfigurable = new Set(
            safeJsonParse(
              await SystemSettings.getValueOrFallback(
                { label: "default_agent_skills" },
                "[]"
              ),
              []
            )
          );

          if (DEFAULT_SKILL_IDS.includes(id)) {
            if (nextEnabled) disabled.delete(id);
            else disabled.add(id);
          } else {
            if (nextEnabled) enabledConfigurable.add(id);
            else enabledConfigurable.delete(id);
          }

          await SystemSettings.updateSettings({
            disabled_agent_skills: [...disabled].join(","),
            default_agent_skills: [...enabledConfigurable].join(","),
          });
          return response.status(200).json({ success: true });
        }

        return response
          .status(400)
          .json({ success: false, error: `Cannot toggle type "${type}".` });
      } catch (error) {
        console.error("skills-marketplace toggle:", error);
        response.status(500).json({ success: false, error: error.message });
      }
    }
  );

  app.post(
    "/skills-marketplace/workspace-assign",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request, response) => {
      try {
        const { slug, id, type, enabled } = reqBody(request);
        if (!slug || !id || !type)
          return response.status(400).json({
            success: false,
            error: "slug, id, and type are required.",
          });

        const workspace = await Workspace.get({ slug });
        if (!workspace)
          return response
            .status(404)
            .json({ success: false, error: "Workspace not found." });

        const catalog = await buildCatalog({ workspace: { ...workspace, agentSkillOverrides: null } });
        let overrides = parseSkillOverrides(workspace);
        if (overrides.useGlobal !== false) {
          overrides = snapshotGlobalEnabled(catalog.items);
        }

        const nextEnabled = Boolean(enabled);
        const toggleIn = (list, value) => {
          const set = new Set(list);
          if (nextEnabled) set.add(value);
          else set.delete(value);
          return [...set];
        };

        if (type === "flow") overrides.flows = toggleIn(overrides.flows, id);
        else if (type === "mcp") overrides.mcp = toggleIn(overrides.mcp, id);
        else overrides.skills = toggleIn(overrides.skills, id);

        overrides.useGlobal = false;
        const { workspace: updated, message } = await Workspace.update(
          workspace.id,
          { agentSkillOverrides: serializeSkillOverrides(overrides) }
        );
        if (!updated)
          return response
            .status(400)
            .json({ success: false, error: message || "Could not update workspace." });

        response.status(200).json({
          success: true,
          overrides: parseSkillOverrides(updated),
          workspace: updated,
        });
      } catch (error) {
        console.error("skills-marketplace workspace-assign:", error);
        response.status(500).json({ success: false, error: error.message });
      }
    }
  );

  app.post(
    "/skills-marketplace/workspace-reset",
    [validatedRequest, flexUserRoleValid([ROLES.admin, ROLES.manager])],
    async (request, response) => {
      try {
        const { slug } = reqBody(request);
        const workspace = await Workspace.get({ slug });
        if (!workspace)
          return response
            .status(404)
            .json({ success: false, error: "Workspace not found." });

        const { workspace: updated, message } = await Workspace.update(
          workspace.id,
          {
            agentSkillOverrides: serializeSkillOverrides({
              useGlobal: true,
              skills: [],
              flows: [],
              mcp: [],
            }),
          }
        );
        if (!updated)
          return response
            .status(400)
            .json({ success: false, error: message || "Could not update workspace." });
        response.status(200).json({
          success: true,
          overrides: parseSkillOverrides(updated),
        });
      } catch (error) {
        console.error("skills-marketplace workspace-reset:", error);
        response.status(500).json({ success: false, error: error.message });
      }
    }
  );

  app.post(
    "/skills-marketplace/mcp/connect",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const { id, values = {} } = reqBody(request);
        const {
          connectFromCatalog,
        } = require("../utils/agents/mcpCatalog");
        const result = await connectFromCatalog(id, values);
        if (!result.success)
          return response.status(400).json({
            success: false,
            error: result.error,
          });
        response.status(200).json({
          success: true,
          name: result.name,
          autoStart: false,
        });
      } catch (error) {
        console.error("skills-marketplace mcp connect:", error);
        response.status(500).json({ success: false, error: error.message });
      }
    }
  );

  app.post(
    "/skills-marketplace/mcp/disconnect",
    [validatedRequest, flexUserRoleValid([ROLES.admin])],
    async (request, response) => {
      try {
        const { name } = reqBody(request);
        const {
          disconnectFromCatalog,
        } = require("../utils/agents/mcpCatalog");
        const result = await disconnectFromCatalog(name);
        if (!result.success)
          return response.status(400).json({
            success: false,
            error: result.error,
          });
        response.status(200).json({ success: true });
      } catch (error) {
        console.error("skills-marketplace mcp disconnect:", error);
        response.status(500).json({ success: false, error: error.message });
      }
    }
  );
}

module.exports = { skillsMarketplaceEndpoints };
