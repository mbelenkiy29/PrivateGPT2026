const prisma = require("../utils/prisma");

const EmbedHandoff = {
  async create(data = {}) {
    try {
      return await prisma.embed_handoffs.create({
        data: {
          embed_id: Number(data.embed_id),
          session_id: String(data.session_id),
          email_to: data.email_to ?? null,
          transcript: data.transcript ?? null,
          status: data.status ?? "open",
        },
      });
    } catch (e) {
      console.error(e);
      return null;
    }
  },

  async where(clause = {}, limit = null, orderBy = null) {
    try {
      return await prisma.embed_handoffs.findMany({
        where: clause,
        ...(limit !== null ? { take: limit } : {}),
        ...(orderBy !== null ? { orderBy } : {}),
      });
    } catch (e) {
      console.error(e);
      return [];
    }
  },
};

module.exports = { EmbedHandoff };
