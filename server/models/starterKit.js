const fs = require("fs");
const path = require("path");

const KIT_ID_RE = /^[a-z0-9-]+$/;
const VALID_CHAT_MODES = ["chat", "query"];
const KIT_ORDER = [
  "customer-support",
  "employee-handbook",
  "sales-proposals",
  "invoice-qa",
  "legal-lite",
  "clinic-sops",
];

function kitsDir() {
  const bundled = path.resolve(__dirname, "../storage/starter-kits");
  if (fs.existsSync(bundled)) return bundled;
  if (process.env.STORAGE_DIR) {
    const fromStorage = path.resolve(process.env.STORAGE_DIR, "starter-kits");
    if (fs.existsSync(fromStorage)) return fromStorage;
  }
  return bundled;
}

function publicKit(kit) {
  if (!kit) return null;
  return {
    id: kit.id,
    name: kit.name,
    description: kit.description,
    chatMode: kit.chatMode,
    createEmbed: kit.createEmbed === true,
    suggestedMessages: Array.isArray(kit.suggestedMessages)
      ? kit.suggestedMessages
      : [],
  };
}

function normalizeSuggestedMessages(messages = []) {
  if (!Array.isArray(messages)) return [];
  return messages
    .map((msg) => ({
      heading: String(msg?.heading || "").slice(0, 255),
      message: String(msg?.message || "").slice(0, 1000),
    }))
    .filter((msg) => msg.heading || msg.message)
    .slice(0, 4);
}

const StarterKit = {
  list: function () {
    try {
      const dir = kitsDir();
      if (!fs.existsSync(dir)) return [];
      return fs
        .readdirSync(dir)
        .filter((file) => file.endsWith(".json"))
        .map((file) => this.get(path.basename(file, ".json")))
        .filter(Boolean)
        .sort((a, b) => {
          const ai = KIT_ORDER.indexOf(a.id);
          const bi = KIT_ORDER.indexOf(b.id);
          return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        })
        .map(publicKit);
    } catch (error) {
      console.error("StarterKit.list error:", error.message);
      return [];
    }
  },

  get: function (kitId) {
    if (!kitId || !KIT_ID_RE.test(String(kitId))) return null;
    const dir = kitsDir();
    const file = path.resolve(dir, `${kitId}.json`);
    const rel = path.relative(path.resolve(dir), file);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
    if (!fs.existsSync(file)) return null;

    try {
      const kit = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!kit?.id || kit.id !== kitId) return null;
      if (!kit.name || typeof kit.name !== "string") return null;
      if (!VALID_CHAT_MODES.includes(kit.chatMode)) return null;
      kit.suggestedMessages = normalizeSuggestedMessages(kit.suggestedMessages);
      kit.createEmbed = kit.createEmbed === true;
      kit.openAiPrompt =
        typeof kit.openAiPrompt === "string" ? kit.openAiPrompt : null;
      kit.queryRefusalResponse =
        typeof kit.queryRefusalResponse === "string"
          ? kit.queryRefusalResponse
          : null;
      return kit;
    } catch (error) {
      console.error("StarterKit.get error:", error.message);
      return null;
    }
  },

  /**
   * Create a workspace from a starter kit, with suggested messages and
   * an optional grounded-only embed widget.
   * @param {string} kitId
   * @param {{userId?: number|null, createEmbed?: boolean}} [options]
   * @returns {Promise<{workspace: object|null, embed: object|null, kit: object|null, message: string|null}>}
   */
  install: async function (kitId, { userId = null, createEmbed } = {}) {
    const kit = this.get(kitId);
    if (!kit)
      return {
        workspace: null,
        embed: null,
        kit: null,
        message: "Unknown starter kit.",
      };

    const { Workspace } = require("./workspace");
    const { workspace, message } = await Workspace.new(kit.name, userId, {
      chatMode: kit.chatMode,
      openAiPrompt: kit.openAiPrompt,
      queryRefusalResponse: kit.queryRefusalResponse,
    });
    if (!workspace) {
      return {
        workspace: null,
        embed: null,
        kit: publicKit(kit),
        message: message || "Failed to create workspace.",
      };
    }

    if (kit.suggestedMessages.length) {
      const {
        WorkspaceSuggestedMessages,
      } = require("./workspacesSuggestedMessages");
      await WorkspaceSuggestedMessages.saveAll(
        kit.suggestedMessages,
        workspace.slug
      );
    }

    const shouldEmbed =
      typeof createEmbed === "boolean" ? createEmbed : kit.createEmbed;
    let embed = null;
    if (shouldEmbed) {
      const { EmbedConfig } = require("./embedConfig");
      const created = await EmbedConfig.new(
        {
          workspace_id: workspace.id,
          chat_mode: kit.chatMode === "chat" ? "chat" : "query",
          grounded_only: true,
          enabled: true,
        },
        userId
      );
      embed = created.embed;
    }

    return { workspace, embed, kit: publicKit(kit), message: null };
  },
};

module.exports = { StarterKit };
