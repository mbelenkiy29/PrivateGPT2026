const prisma = require("../utils/prisma");
const { assertTenant } = require("../utils/tenant");

const TenantSettings = {
  get: async function (organizationId, label) {
    try {
      return (
        (await prisma.tenant_settings.findFirst({
          where: assertTenant({ label }, organizationId),
        })) || null
      );
    } catch (error) {
      console.error(error.message);
      return null;
    }
  },

  where: async function (organizationId, clause = {}) {
    try {
      return await prisma.tenant_settings.findMany({
        where: assertTenant(clause, organizationId),
      });
    } catch (error) {
      console.error(error.message);
      return [];
    }
  },

  set: async function (organizationId, label, value) {
    try {
      const orgId = Number(organizationId);
      const setting = await prisma.tenant_settings.upsert({
        where: {
          organizationId_label: { organizationId: orgId, label },
        },
        update: {
          value: value == null ? null : String(value),
          lastUpdatedAt: new Date(),
        },
        create: {
          organizationId: orgId,
          label,
          value: value == null ? null : String(value),
        },
      });
      return { setting, error: null };
    } catch (error) {
      console.error("FAILED TO SET TENANT SETTING.", error.message);
      return { setting: null, error: error.message };
    }
  },
};

module.exports = { TenantSettings };
