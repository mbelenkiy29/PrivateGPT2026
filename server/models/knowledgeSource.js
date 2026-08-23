const prisma = require("../utils/prisma");
const { EncryptionManager } = require("../utils/EncryptionManager");

const encryptor = new EncryptionManager();

const KnowledgeSource = {
  encrypt(value) {
    if (!value) return null;
    return encryptor.encrypt(String(value));
  },

  decrypt(value) {
    if (!value) return null;
    return encryptor.decrypt(value);
  },

  encryptConfig(config) {
    if (config == null) return null;
    return this.encrypt(
      typeof config === "string" ? config : JSON.stringify(config)
    );
  },

  async get(clause = {}) {
    try {
      return await prisma.knowledge_sources.findFirst({ where: clause });
    } catch (e) {
      console.error(e);
      return null;
    }
  },

  async where(clause = {}, limit = null, orderBy = null) {
    try {
      return await prisma.knowledge_sources.findMany({
        where: clause,
        ...(limit !== null ? { take: limit } : {}),
        ...(orderBy !== null ? { orderBy } : {}),
      });
    } catch (e) {
      console.error(e);
      return [];
    }
  },

  async create(data = {}) {
    try {
      const encrypted_config =
        data.config != null
          ? this.encryptConfig(data.config)
          : data.encrypted_config ?? null;

      return await prisma.knowledge_sources.create({
        data: {
          provider: String(data.provider),
          workspaceId: Number(data.workspaceId),
          display_name: String(data.display_name),
          remote_id: data.remote_id ?? null,
          encrypted_config,
          sync_cursor: data.sync_cursor ?? null,
          watch_enabled:
            data.watch_enabled === undefined
              ? true
              : Boolean(data.watch_enabled),
        },
      });
    } catch (e) {
      console.error(e);
      return null;
    }
  },

  async update(id, data = {}) {
    if (!id) throw new Error("No id provided for update");

    try {
      const payload = { lastUpdatedAt: new Date() };
      const keys = [
        "display_name",
        "remote_id",
        "sync_cursor",
        "watch_enabled",
        "last_synced_at",
        "last_error",
        "encrypted_config",
      ];
      for (const key of keys) {
        if (data.hasOwnProperty(key)) payload[key] = data[key];
      }
      if (data.config != null)
        payload.encrypted_config = this.encryptConfig(data.config);

      return await prisma.knowledge_sources.update({
        where: { id: Number(id) },
        data: payload,
      });
    } catch (e) {
      console.error(e);
      return null;
    }
  },

  async delete(id) {
    try {
      await prisma.knowledge_sources.delete({ where: { id: Number(id) } });
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  },
};

module.exports = { KnowledgeSource };
