const { SystemSettings } = require("../../models/systemSettings");
const { safeJsonParse } = require("../http");
const { AgentFlows } = require("../agentFlows");
const { CommunityHub } = require("../../models/communityHub");
const ImportedPlugin = require("./imported");
const { parseSkillOverrides, importedSkillId } = require("./skillOverrides");

const DEFAULT_SKILL_IDS = [
  "rag-memory",
  "document-summarizer",
  "web-scraping",
];

const BUILTIN_SKILLS = [
  {
    id: "rag-memory",
    name: "RAG & long-term memory",
    description:
      "Let the agent use workspace documents or remember facts for later retrieval.",
    category: "default",
    type: "builtin",
    configurable: false,
  },
  {
    id: "document-summarizer",
    name: "View & summarize documents",
    description:
      "Let the agent list and summarize files currently embedded in the workspace.",
    category: "default",
    type: "builtin",
    configurable: false,
  },
  {
    id: "web-scraping",
    name: "Scrape websites",
    description: "Let the agent visit a URL and read the page contents.",
    category: "default",
    type: "builtin",
    configurable: false,
  },
  {
    id: "filesystem-agent",
    name: "File System Access",
    description:
      "Read, write, search, and manage files in a designated directory.",
    category: "configurable",
    type: "builtin",
    configurable: true,
  },
  {
    id: "create-files-agent",
    name: "Generate & save files",
    description: "Create PDF, Word, Excel, PowerPoint, and text files from chat.",
    category: "configurable",
    type: "builtin",
    configurable: true,
  },
  {
    id: "create-chart",
    name: "Generate charts",
    description: "Generate charts from data provided in chat.",
    category: "configurable",
    type: "builtin",
    configurable: true,
  },
  {
    id: "web-browsing",
    name: "Web Search",
    description: "Search the web through a connected SERP provider.",
    category: "configurable",
    type: "builtin",
    configurable: true,
  },
  {
    id: "sql-agent",
    name: "SQL Connector",
    description: "Query connected SQL databases to answer questions.",
    category: "configurable",
    type: "builtin",
    configurable: true,
  },
  {
    id: "create-scheduled-job",
    name: "Create scheduled jobs",
    description:
      "Create recurring jobs from chat. Available in single-user mode only.",
    category: "configurable",
    type: "builtin",
    configurable: true,
    singleUserOnly: true,
  },
  {
    id: "gmail-agent",
    name: "Gmail",
    description: "Read, search, and draft Gmail messages.",
    category: "integration",
    type: "builtin",
    configurable: true,
    singleUserOnly: true,
  },
  {
    id: "google-calendar-agent",
    name: "Google Calendar",
    description: "List and manage Google Calendar events.",
    category: "integration",
    type: "builtin",
    configurable: true,
    singleUserOnly: true,
  },
  {
    id: "outlook-agent",
    name: "Outlook",
    description: "Read and draft Outlook mail.",
    category: "integration",
    type: "builtin",
    configurable: true,
    singleUserOnly: true,
  },
];

function item({
  id,
  name,
  description = "",
  type,
  category,
  enabled = false,
  installed = true,
  origin,
  extra = {},
}) {
  return {
    id,
    name,
    description,
    type,
    category,
    enabled: Boolean(enabled),
    installed: Boolean(installed),
    origin: origin || type,
    ...extra,
  };
}

async function loadSkillSettings() {
  const [disabledRaw, enabledRaw] = await Promise.all([
    SystemSettings.getValueOrFallback({ label: "disabled_agent_skills" }, "[]"),
    SystemSettings.getValueOrFallback({ label: "default_agent_skills" }, "[]"),
  ]);
  return {
    disabledDefaults: safeJsonParse(disabledRaw, []),
    enabledConfigurable: safeJsonParse(enabledRaw, []),
  };
}

function isBuiltinEnabled(skill, { disabledDefaults, enabledConfigurable }) {
  if (DEFAULT_SKILL_IDS.includes(skill.id))
    return !disabledDefaults.includes(skill.id);
  return enabledConfigurable.includes(skill.id);
}

function isSkillEnabledForWorkspace(skill, overrides) {
  if (skill.type === "flow") return overrides.flows.includes(skill.id);
  if (skill.type === "mcp") return overrides.mcp.includes(skill.id);
  if (skill.type === "imported")
    return (
      overrides.skills.includes(skill.id) ||
      overrides.skills.includes(`@@${skill.id}`)
    );
  return overrides.skills.includes(skill.id);
}

async function builtinItems(settings, isMultiUser) {
  return BUILTIN_SKILLS.filter(
    (skill) => !(skill.singleUserOnly && isMultiUser)
  ).map((skill) =>
    item({
      ...skill,
      enabled: isBuiltinEnabled(skill, settings),
      origin: "builtin",
      extra: { singleUserOnly: Boolean(skill.singleUserOnly) },
    })
  );
}

function importedItems() {
  return ImportedPlugin.listImportedPlugins().map((plugin) =>
    item({
      id: plugin.hubId,
      name: plugin.name || plugin.hubId,
      description: plugin.description || "",
      type: "imported",
      category: "imported",
      enabled: Boolean(plugin.active),
      origin: "local",
      extra: {
        hubId: plugin.hubId,
        author: plugin.author || null,
        version: plugin.version || null,
        setupArgs: plugin.setup_args || {},
        examples: plugin.examples || [],
        active: Boolean(plugin.active),
        createdLocally: Boolean(plugin.createdLocally),
      },
    })
  );
}

function flowItems() {
  return AgentFlows.listFlows().map((flow) =>
    item({
      id: flow.uuid,
      name: flow.name,
      description: flow.description || "Custom no-code agent flow.",
      type: "flow",
      category: "flow",
      enabled: flow.active !== false,
      origin: "flow",
      extra: { uuid: flow.uuid },
    })
  );
}

async function withTimeout(promise, ms, fallback) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Timed out")), ms);
      }),
    ]);
  } catch (error) {
    return typeof fallback === "function" ? fallback(error) : fallback;
  } finally {
    clearTimeout(timer);
  }
}

async function mcpItems() {
  const { listEntries } = require("./mcpCatalog");
  const catalog = listEntries();
  let live = [];
  try {
    const MCPCompatibilityLayer = require("../MCP");
    live = await withTimeout(
      new MCPCompatibilityLayer().servers(),
      5000,
      []
    );
    if (!Array.isArray(live)) live = [];
  } catch (error) {
    console.error("skillCatalog mcpItems:", error);
    live = [];
  }

  const liveByName = new Map(live.map((server) => [server.name, server]));
  const items = [];

  for (const entry of catalog) {
    const server = liveByName.get(entry.id);
    liveByName.delete(entry.id);
    items.push(
      item({
        id: entry.id,
        name: entry.name,
        description: server
          ? server.error ||
            `${(server.tools || []).length} tool${
              (server.tools || []).length === 1 ? "" : "s"
            } via MCP.`
          : entry.description,
        type: "mcp",
        category: "mcp",
        enabled: Boolean(server?.running),
        installed: Boolean(server),
        origin: "mcp",
        extra: {
          catalog: true,
          risk: entry.risk,
          fields: entry.fields,
          transport: entry.transport,
          command: entry.command,
          running: Boolean(server?.running),
          error: server?.error || null,
          tools: (server?.tools || []).map((tool) => ({
            name: tool.name,
            description: tool.description || "",
          })),
        },
      })
    );
  }

  for (const server of liveByName.values()) {
    items.push(
      item({
        id: server.name,
        name: server.name,
        description:
          server.error ||
          `${(server.tools || []).length} tool${
            (server.tools || []).length === 1 ? "" : "s"
          } via MCP.`,
        type: "mcp",
        category: "mcp",
        enabled: Boolean(server.running),
        installed: true,
        origin: "mcp",
        extra: {
          catalog: false,
          running: Boolean(server.running),
          error: server.error || null,
          tools: (server.tools || []).map((tool) => ({
            name: tool.name,
            description: tool.description || "",
          })),
        },
      })
    );
  }

  return items;
}

async function hubItems(importedHubIds) {
  try {
    const explore = await withTimeout(
      CommunityHub.fetchExploreItems(),
      4000,
      { agentSkills: { items: [] } }
    );
    const skills = explore?.agentSkills?.items || [];
    return skills.map((skill) => {
      const hubId = skill.id || skill.hubId;
      const already = importedHubIds.has(String(hubId));
      return item({
        id: hubId || skill.importId,
        name: skill.name,
        description: skill.description || "",
        type: "hub",
        category: "hub",
        enabled: false,
        installed: already,
        origin: "hub",
        extra: {
          importId: skill.importId,
          verified: Boolean(skill.verified),
          visibility: skill.visibility || "public",
          author: skill.creatorUsername || skill.author || null,
        },
      });
    });
  } catch (error) {
    console.error("skillCatalog hubItems:", error);
    return { items: [], error: error.message };
  }
}

/**
 * Build the unified Skills Marketplace catalog.
 * @param {{ workspace?: object|null }} [opts]
 */
async function buildCatalog({ workspace = null } = {}) {
  const isMultiUser = await SystemSettings.isMultiUserMode();
  const settings = await loadSkillSettings();
  const overrides = parseSkillOverrides(workspace);
  const useWorkspace = Boolean(workspace) && overrides.useGlobal === false;

  const [mcp, hubResult] = await Promise.all([
    mcpItems(),
    hubItems(new Set(ImportedPlugin.listImportedPlugins().map((p) => p.hubId))),
  ]);

  const hubError =
    hubResult && !Array.isArray(hubResult) ? hubResult.error : null;
  const hub = Array.isArray(hubResult) ? hubResult : hubResult.items || [];

  let items = [
    ...(await builtinItems(settings, isMultiUser)),
    ...importedItems(),
    ...flowItems(),
    ...mcp,
    ...hub,
  ];

  if (useWorkspace) {
    items = items.map((entry) => {
      if (entry.type === "hub" && !entry.installed) return entry;
      return {
        ...entry,
        enabled: isSkillEnabledForWorkspace(entry, overrides),
      };
    });
  }

  return {
    items,
    hubError,
    overrides,
    useWorkspace,
  };
}

function snapshotGlobalEnabled(items) {
  return {
    useGlobal: false,
    skills: items
      .filter(
        (entry) =>
          entry.enabled && (entry.type === "builtin" || entry.type === "imported")
      )
      .map((entry) =>
        entry.type === "imported" ? importedSkillId(entry.id) : entry.id
      ),
    flows: items
      .filter((entry) => entry.enabled && entry.type === "flow")
      .map((entry) => entry.id),
    mcp: items
      .filter((entry) => entry.enabled && entry.type === "mcp")
      .map((entry) => entry.id),
  };
}

module.exports = {
  BUILTIN_SKILLS,
  DEFAULT_SKILL_IDS,
  buildCatalog,
  snapshotGlobalEnabled,
  loadSkillSettings,
};
