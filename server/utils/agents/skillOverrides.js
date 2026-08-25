const { safeJsonParse } = require("../http");

const EMPTY_OVERRIDES = {
  useGlobal: true,
  skills: [],
  flows: [],
  mcp: [],
};

/**
 * Parse a workspace's agentSkillOverrides JSON.
 * @param {import("@prisma/client").workspaces | object | null} workspace
 * @returns {{ useGlobal: boolean, skills: string[], flows: string[], mcp: string[] }}
 */
function parseSkillOverrides(workspace) {
  const raw = workspace?.agentSkillOverrides;
  if (!raw) return { ...EMPTY_OVERRIDES };

  const parsed = typeof raw === "string" ? safeJsonParse(raw, null) : raw;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ...EMPTY_OVERRIDES };
  }

  return {
    useGlobal: parsed.useGlobal !== false,
    skills: sanitizeIdList(parsed.skills || parsed.enabled),
    flows: sanitizeIdList(parsed.flows),
    mcp: sanitizeIdList(parsed.mcp),
  };
}

function sanitizeIdList(value) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item) => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    ),
  ];
}

/**
 * Serialize overrides for storage on the workspace row.
 * @param {object} overrides
 * @returns {string}
 */
function serializeSkillOverrides(overrides = {}) {
  const next = {
    useGlobal: overrides.useGlobal !== false,
    skills: sanitizeIdList(overrides.skills),
    flows: sanitizeIdList(overrides.flows),
    mcp: sanitizeIdList(overrides.mcp),
  };
  return JSON.stringify(next);
}

function importedSkillId(hubId = "") {
  return String(hubId).replace(/^@@/, "");
}

module.exports = {
  EMPTY_OVERRIDES,
  parseSkillOverrides,
  serializeSkillOverrides,
  sanitizeIdList,
  importedSkillId,
};
