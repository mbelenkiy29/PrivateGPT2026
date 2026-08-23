const prisma = require("../utils/prisma");

const ChannelWorkspaceBinding = {
  async get({ connector_type, external_id } = {}) {
    if (!connector_type || !external_id) return null;
    try {
      return await prisma.channel_workspace_bindings.findUnique({
        where: {
          connector_type_external_id: {
            connector_type: String(connector_type),
            external_id: String(external_id),
          },
        },
      });
    } catch (e) {
      console.error(e);
      return null;
    }
  },

  async upsert({ connector_type, external_id, workspaceId, threadSlug } = {}) {
    try {
      const update = {
        workspaceId: Number(workspaceId),
        lastUpdatedAt: new Date(),
      };
      if (threadSlug !== undefined) update.threadSlug = threadSlug ?? null;

      return await prisma.channel_workspace_bindings.upsert({
        where: {
          connector_type_external_id: {
            connector_type: String(connector_type),
            external_id: String(external_id),
          },
        },
        update,
        create: {
          connector_type: String(connector_type),
          external_id: String(external_id),
          workspaceId: Number(workspaceId),
          threadSlug: threadSlug ?? null,
        },
      });
    } catch (e) {
      console.error(e);
      return null;
    }
  },
};

module.exports = { ChannelWorkspaceBinding };
