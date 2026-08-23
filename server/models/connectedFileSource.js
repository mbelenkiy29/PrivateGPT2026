const prisma = require("../utils/prisma");
const { EncryptionManager } = require("../utils/EncryptionManager");

const encryptor = new EncryptionManager();

const ConnectedFileSource = {
  providers: {
    onedrive: "onedrive",
    googleDrive: "google-drive",
  },

  encrypt(value) {
    if (!value) return null;
    return encryptor.encrypt(String(value));
  },

  decrypt(value) {
    if (!value) return null;
    return encryptor.decrypt(value);
  },

  async get(clause = {}) {
    try {
      return await prisma.connected_file_sources.findFirst({ where: clause });
    } catch (e) {
      console.error(e);
      return null;
    }
  },

  async where(clause = {}) {
    try {
      return await prisma.connected_file_sources.findMany({ where: clause });
    } catch (e) {
      console.error(e);
      return [];
    }
  },

  async upsertByProvider(provider, data = {}) {
    const existing = await this.get({ provider });
    const payload = {
      account_email: data.account_email ?? existing?.account_email ?? null,
      account_name: data.account_name ?? existing?.account_name ?? null,
      encrypted_access_token:
        data.access_token != null
          ? this.encrypt(data.access_token)
          : existing?.encrypted_access_token,
      encrypted_refresh_token:
        data.refresh_token != null
          ? this.encrypt(data.refresh_token)
          : existing?.encrypted_refresh_token,
      token_expires_at:
        data.token_expires_at ?? existing?.token_expires_at ?? null,
      lastUpdatedAt: new Date(),
    };

    if (existing) {
      return await prisma.connected_file_sources.update({
        where: { id: existing.id },
        data: payload,
      });
    }

    return await prisma.connected_file_sources.create({
      data: { provider, ...payload },
    });
  },

  async delete(id) {
    try {
      await prisma.connected_file_sources.delete({ where: { id: Number(id) } });
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  },

  toPublic(record) {
    if (!record) return null;
    return {
      id: record.id,
      provider: record.provider,
      accountEmail: record.account_email,
      accountName: record.account_name,
      connected: true,
    };
  },

  tokens(record) {
    if (!record) return { accessToken: null, refreshToken: null };
    return {
      accessToken: this.decrypt(record.encrypted_access_token),
      refreshToken: this.decrypt(record.encrypted_refresh_token),
      expiresAt: record.token_expires_at
        ? new Date(record.token_expires_at).getTime()
        : 0,
    };
  },
};

module.exports = { ConnectedFileSource };
