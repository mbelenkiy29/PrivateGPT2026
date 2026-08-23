const prisma = require("../utils/prisma");

const EmbedUnanswered = {
  async create(data = {}) {
    try {
      return await prisma.embed_unanswered.create({
        data: {
          embed_id: Number(data.embed_id),
          session_id: data.session_id ?? null,
          question: String(data.question),
        },
      });
    } catch (e) {
      console.error(e);
      return null;
    }
  },

  async where(clause = {}, limit = null, orderBy = null) {
    try {
      return await prisma.embed_unanswered.findMany({
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

module.exports = { EmbedUnanswered };
