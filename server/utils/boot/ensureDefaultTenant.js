const prisma = require("../prisma");
const { Organization } = require("../../models/organization");
const { DEFAULT_ORG_SLUG, setCachedDefaultOrgId } = require("../tenant");

const TENANT_TABLES = [
  "workspaces",
  "invites",
  "api_keys",
  "workspace_chats",
  "embed_configs",
  "knowledge_sources",
  "connected_file_sources",
  "external_communication_connectors",
  "scheduled_jobs",
  "model_routers",
  "usage_events",
  "tickets",
  "memories",
];

/**
 * Idempotent backfill used on boot and in tests. The SQL migration already
 * does this for existing installs; this covers rows created before the
 * helper ran or databases pushed via `prisma db push`.
 */
async function ensureDefaultTenant() {
  try {
    const organization = await Organization.ensureDefault();
    if (!organization) return null;
    setCachedDefaultOrgId(organization.id);

    const users = await prisma.users.findMany({
      select: { id: true, role: true },
    });
    for (const user of users) {
      await Organization.addMember({
        organizationId: organization.id,
        userId: user.id,
        role: user.role || "default",
      });
    }

    for (const table of TENANT_TABLES) {
      try {
        await prisma[table].updateMany({
          where: { organizationId: null },
          data: { organizationId: organization.id },
        });
      } catch (error) {
        // Table may not exist in a partial test schema.
        if (!/Unknown arg|does not exist/i.test(error.message)) {
          console.error(`[tenant] failed to backfill ${table}:`, error.message);
        }
      }
    }

    return organization;
  } catch (error) {
    console.error("[tenant] ensureDefaultTenant failed:", error.message);
    return null;
  }
}

module.exports = { ensureDefaultTenant, DEFAULT_ORG_SLUG };
