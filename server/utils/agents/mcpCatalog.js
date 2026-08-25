const ALLOWED_COMMANDS = new Set(["npx", "uvx", "node"]);
const ALLOWED_HTTP_TYPES = new Set(["sse", "streamable", "http"]);

/**
 * Curated MCP servers that can be connected from Skills Marketplace.
 * `command` + first non-flag arg must match this list; unknown npx packages are rejected.
 */
const MCP_CATALOG = [
  {
    id: "github",
    name: "GitHub",
    description: "Repos, issues, PRs, and file contents via a GitHub personal access token.",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    fields: [
      {
        key: "GITHUB_PERSONAL_ACCESS_TOKEN",
        kind: "env",
        label: "GitHub personal access token",
        required: true,
        secret: true,
      },
    ],
    risk: "Runs npx and can read or change GitHub as this token.",
  },
  {
    id: "slack",
    name: "Slack",
    description: "List channels and post or read Slack messages.",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-slack"],
    fields: [
      {
        key: "SLACK_BOT_TOKEN",
        kind: "env",
        label: "Slack bot token",
        required: true,
        secret: true,
      },
      {
        key: "SLACK_TEAM_ID",
        kind: "env",
        label: "Slack team ID",
        required: true,
        secret: false,
      },
    ],
    risk: "Runs npx and can post to Slack as this bot.",
  },
  {
    id: "postgres",
    name: "Postgres",
    description: "Run read queries against a PostgreSQL database.",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres"],
    fields: [
      {
        key: "POSTGRES_CONNECTION_STRING",
        kind: "arg",
        label: "Postgres connection string",
        required: true,
        secret: true,
      },
    ],
    risk: "Runs npx and can query the database in this connection string.",
  },
  {
    id: "brave-search",
    name: "Brave Search",
    description: "Web search through the Brave Search API.",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    fields: [
      {
        key: "BRAVE_API_KEY",
        kind: "env",
        label: "Brave Search API key",
        required: true,
        secret: true,
      },
    ],
    risk: "Runs npx and sends search queries to Brave.",
  },
  {
    id: "memory",
    name: "Knowledge graph memory",
    description: "Persistent entity memory the agent can read and write across chats.",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-memory"],
    fields: [],
    risk: "Runs npx and stores memories on this machine.",
  },
  {
    id: "fetch",
    name: "Fetch URL",
    description: "Fetch a URL and return the page as markdown or text.",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-fetch"],
    fields: [],
    risk: "Runs npx and can request arbitrary URLs from this host.",
  },
  {
    id: "puppeteer",
    name: "Puppeteer",
    description: "Browse and screenshot pages with a headless browser.",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
    fields: [],
    risk: "Runs npx and a browser on this machine.",
  },
  {
    id: "sequential-thinking",
    name: "Sequential thinking",
    description: "A structured thinking tool the agent can use for multi-step reasoning.",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    fields: [],
    risk: "Runs npx. No external account required.",
  },
  {
    id: "filesystem",
    name: "Filesystem (MCP)",
    description: "Read and write files in one folder you choose.",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
    fields: [
      {
        key: "rootPath",
        kind: "arg",
        label: "Folder path to expose",
        required: true,
        secret: false,
      },
    ],
    risk: "Runs npx and can read or change files in that folder.",
  },
  {
    id: "sqlite",
    name: "SQLite",
    description: "Query a local SQLite database file.",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sqlite"],
    fields: [
      {
        key: "dbPath",
        kind: "arg",
        label: "Path to .sqlite file",
        required: true,
        secret: false,
      },
    ],
    risk: "Runs npx and can query that database file.",
  },
  {
    id: "google-maps",
    name: "Google Maps",
    description: "Places, directions, and geocoding via a Google Maps API key.",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-google-maps"],
    fields: [
      {
        key: "GOOGLE_MAPS_API_KEY",
        kind: "env",
        label: "Google Maps API key",
        required: true,
        secret: true,
      },
    ],
    risk: "Runs npx and sends requests to Google Maps.",
  },
  {
    id: "youtube",
    name: "YouTube",
    description: "Fetch YouTube video transcripts (uvx mcp-youtube).",
    command: "uvx",
    args: ["mcp-youtube"],
    fields: [],
    risk: "Runs uvx and requests YouTube data.",
  },
  {
    id: "remote-http",
    name: "Remote HTTP MCP",
    description: "Connect to an MCP server you already host over HTTP or SSE.",
    transport: "http",
    httpType: "streamable",
    fields: [
      {
        key: "url",
        kind: "url",
        label: "MCP server URL",
        required: true,
        secret: false,
      },
      {
        key: "Authorization",
        kind: "header",
        label: "Authorization header (optional)",
        required: false,
        secret: true,
      },
    ],
    risk: "This host will call the URL you enter. Only use servers you trust.",
  },
];

function packageFromArgs(args = []) {
  const flags = new Set(["-y", "-p", "--yes", "--package"]);
  return args.find((arg) => !String(arg).startsWith("-") && !flags.has(arg)) || null;
}

const ALLOWED_PACKAGES = new Set(
  MCP_CATALOG.filter((entry) => entry.command).map((entry) =>
    packageFromArgs(entry.args)
  )
);

function publicEntry(entry) {
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    risk: entry.risk,
    transport: entry.transport || "stdio",
    command: entry.command || null,
    fields: (entry.fields || []).map((field) => ({
      key: field.key,
      kind: field.kind,
      label: field.label,
      required: Boolean(field.required),
      secret: Boolean(field.secret),
    })),
  };
}

function getEntry(id) {
  return MCP_CATALOG.find((entry) => entry.id === id) || null;
}

function listEntries() {
  return MCP_CATALOG.map(publicEntry);
}

function isSafeHttpUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Build an AnythingLLM MCP server definition from a catalog id + form values.
 * @param {string} id
 * @param {Record<string, string>} values
 * @returns {{ success: boolean, name?: string, server?: object, error?: string }}
 */
function buildServerDefinition(id, values = {}) {
  const entry = getEntry(id);
  if (!entry) return { success: false, error: "That MCP server is not in the catalog." };

  for (const field of entry.fields || []) {
    const value = String(values[field.key] || "").trim();
    if (field.required && !value)
      return { success: false, error: `${field.label} is required.` };
  }

  if (entry.transport === "http") {
    const url = String(values.url || "").trim();
    if (!isSafeHttpUrl(url))
      return { success: false, error: "Enter an http or https MCP URL." };
    const headers = {};
    for (const field of entry.fields || []) {
      if (field.kind !== "header") continue;
      const value = String(values[field.key] || "").trim();
      if (value) headers[field.key] = value;
    }
    const httpType = ALLOWED_HTTP_TYPES.has(entry.httpType)
      ? entry.httpType
      : "streamable";
    return {
      success: true,
      name: entry.id,
      server: {
        type: httpType,
        url,
        ...(Object.keys(headers).length ? { headers } : {}),
        anythingllm: { autoStart: false },
      },
    };
  }

  if (!ALLOWED_COMMANDS.has(entry.command))
    return { success: false, error: "Command is not allowed." };

  const pkg = packageFromArgs(entry.args);
  if (!pkg || !ALLOWED_PACKAGES.has(pkg))
    return { success: false, error: "Package is not on the allowlist." };

  const args = [...entry.args];
  const env = {};
  for (const field of entry.fields || []) {
    const value = String(values[field.key] || "").trim();
    if (!value) continue;
    if (field.kind === "env") env[field.key] = value;
    if (field.kind === "arg") args.push(value);
  }

  return {
    success: true,
    name: entry.id,
    server: {
      command: entry.command,
      args,
      ...(Object.keys(env).length ? { env } : {}),
      anythingllm: { autoStart: false },
    },
  };
}

async function connectFromCatalog(id, values = {}) {
  const built = buildServerDefinition(id, values);
  if (!built.success) return built;

  const MCPCompatibilityLayer = require("../MCP");
  const mcp = new MCPCompatibilityLayer();
  const existing = mcp.mcpServerConfigs.find((s) => s.name === built.name);
  if (existing)
    return {
      success: false,
      error: `MCP server "${built.name}" is already connected.`,
    };

  const written = mcp.addMCPServerToConfig(built.name, built.server);
  if (!written.success) return written;
  return { success: true, name: built.name, autoStart: false };
}

async function disconnectFromCatalog(name) {
  const MCPCompatibilityLayer = require("../MCP");
  return await new MCPCompatibilityLayer().deleteServer(name);
}

module.exports = {
  MCP_CATALOG,
  ALLOWED_COMMANDS,
  ALLOWED_PACKAGES,
  listEntries,
  getEntry,
  publicEntry,
  packageFromArgs,
  buildServerDefinition,
  connectFromCatalog,
  disconnectFromCatalog,
};
