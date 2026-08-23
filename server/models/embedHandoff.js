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

  async where(clause = {}, limit = null, orderBy = null, offset = null) {
    try {
      return await prisma.embed_handoffs.findMany({
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
      return await prisma.embed_handoffs.findMany({
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
      return await prisma.embed_handoffs.count({ where: clause });
    } catch (e) {
      console.error(e);
      return 0;
    }
  },
};

module.exports = { EmbedHandoff };
