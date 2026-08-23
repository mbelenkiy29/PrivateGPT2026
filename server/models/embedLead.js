const prisma = require("../utils/prisma");

const EmbedLead = {
  async create(data = {}) {
    try {
      return await prisma.embed_leads.create({
        data: {
          embed_id: Number(data.embed_id),
          name: data.name ?? null,
          email: data.email ?? null,
          last_question: data.last_question ?? null,
          session_id: data.session_id ?? null,
        },
      });
    } catch (e) {
      console.error(e);
      return null;
    }
  },

  async where(clause = {}, limit = null, orderBy = null) {
    try {
      return await prisma.embed_leads.findMany({
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

module.exports = { EmbedLead };
