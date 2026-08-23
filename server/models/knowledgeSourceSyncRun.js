const prisma = require("../utils/prisma");

const KnowledgeSourceSyncRun = {
  statuses: {
    unknown: "unknown",
    exited: "exited",
    failed: "failed",
    success: "success",
  },

  save: async function (sourceId = null, status = null, result = {}) {
    try {
      if (!this.statuses.hasOwnProperty(status))
        throw new Error(
          `KnowledgeSourceSyncRun status ${status} is not a valid status.`
        );

      const run = await prisma.knowledge_source_sync_runs.create({
        data: {
          sourceId: Number(sourceId),
          status: String(status),
          result: JSON.stringify(result),
        },
      });
      return run || null;
    } catch (error) {
      console.error(error.message);
      return null;
    }
  },

  get: async function (clause = {}) {
    try {
      const run = await prisma.knowledge_source_sync_runs.findFirst({
        where: clause,
      });
      return run || null;
    } catch (error) {
      console.error(error.message);
      return null;
    }
  },

  where: async function (
    clause = {},
    limit = null,
    orderBy = null,
    include = {}
  ) {
    try {
      const results = await prisma.knowledge_source_sync_runs.findMany({
        where: clause,
        ...(limit !== null ? { take: limit } : {}),
        ...(orderBy !== null ? { orderBy } : {}),
        ...(include !== null ? { include } : {}),
      });
      return results;
    } catch (error) {
      console.error(error.message);
      return [];
    }
  },
};

module.exports = { KnowledgeSourceSyncRun };
