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

  async where(clause = {}, limit = null, orderBy = null, offset = null) {
    try {
      return await prisma.embed_unanswered.findMany({
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
      return await prisma.embed_unanswered.findMany({
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
      return await prisma.embed_unanswered.count({ where: clause });
    } catch (e) {
      console.error(e);
      return 0;
    }
  },
};

module.exports = { EmbedUnanswered };
