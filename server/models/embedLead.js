const prisma = require("../utils/prisma");

const embedWorkspaceInclude = {
  embed_config: {
    select: {
      uuid: true,
      workspace: {
        select: { name: true },
      },
    },
  },
};

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

  async where(clause = {}, limit = null, orderBy = null, offset = null) {
    try {
      return await prisma.embed_leads.findMany({
        where: clause,
        ...(limit !== null ? { take: limit } : {}),
        ...(offset !== null ? { skip: offset } : {}),
        ...(orderBy !== null ? { orderBy } : {}),
      });
    } catch (e) {
      console.error(e);
      return [];
    }
  },

  async whereWithEmbed(
    clause = {},
    limit = null,
    orderBy = null,
    offset = null
  ) {
    try {
      return await prisma.embed_leads.findMany({
        where: clause,
        include: embedWorkspaceInclude,
        ...(limit !== null ? { take: limit } : {}),
        ...(offset !== null ? { skip: offset } : {}),
        ...(orderBy !== null ? { orderBy } : {}),
      });
    } catch (e) {
      console.error(e);
      return [];
    }
  },

  async count(clause = {}) {
    try {
      return await prisma.embed_leads.count({ where: clause });
    } catch (e) {
      console.error(e);
      return 0;
    }
  },
};

module.exports = { EmbedLead };
