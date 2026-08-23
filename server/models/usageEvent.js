const prisma = require("../utils/prisma");

const UsageEvent = {
  sources: {
    chat: "chat",
    embed: "embed",
    agent: "agent",
    channel: "channel",
  },

  async create(data = {}) {
    try {
      return await prisma.usage_events.create({
        data: {
          workspaceId:
            data.workspaceId != null ? Number(data.workspaceId) : null,
          userId: data.userId != null ? Number(data.userId) : null,
          provider: data.provider ?? null,
          model: data.model ?? null,
          local: Boolean(data.local),
          prompt_tokens: Number(data.prompt_tokens) || 0,
          completion_tokens: Number(data.completion_tokens) || 0,
          cost_usd: Number(data.cost_usd) || 0,
          source: String(data.source),
        },
      });
    } catch (e) {
      console.error(e);
      return null;
    }
  },

  async where(clause = {}, limit = null, orderBy = null) {
    try {
      return await prisma.usage_events.findMany({
        where: clause,
        ...(limit !== null ? { take: limit } : {}),
        ...(orderBy !== null ? { orderBy } : {}),
      });
    } catch (e) {
      console.error(e);
      return [];
    }
  },

  async monthlySummary({ workspaceId, since } = {}) {
    try {
      const where = {};
      if (workspaceId != null) where.workspaceId = Number(workspaceId);
      if (since) where.createdAt = { gte: new Date(since) };

      const summary = await prisma.usage_events.aggregate({
        where,
        _sum: {
          prompt_tokens: true,
          completion_tokens: true,
          cost_usd: true,
        },
        _count: true,
      });

      return {
        prompt_tokens: summary._sum.prompt_tokens || 0,
        completion_tokens: summary._sum.completion_tokens || 0,
        cost_usd: summary._sum.cost_usd || 0,
        count: summary._count || 0,
      };
    } catch (e) {
      console.error(e);
      return {
        prompt_tokens: 0,
        completion_tokens: 0,
        cost_usd: 0,
        count: 0,
      };
    }
  },
};

module.exports = { UsageEvent };
