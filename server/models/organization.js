const prisma = require("../utils/prisma");
const {
  DEFAULT_ORG_NAME,
  DEFAULT_ORG_SLUG,
  slugifyOrgName,
  setCachedDefaultOrgId,
  publicOrganization,
} = require("../utils/tenant");

const Organization = {
  writable: ["name", "status"],

  create: async function ({ name, slug = null, status = "active" }) {
    const baseSlug = slug || slugifyOrgName(name);
    let candidate = baseSlug;
    let attempt = 0;
    while (attempt < 25) {
      const existing = await this.get({ slug: candidate });
      if (!existing) break;
      attempt += 1;
      candidate = `${baseSlug}-${Math.floor(1000 + Math.random() * 9000)}`;
    }

    try {
      const organization = await prisma.organizations.create({
        data: {
          name: String(name || "Workspace").slice(0, 255),
          slug: candidate,
          status,
        },
      });
      return { organization, error: null };
    } catch (error) {
      console.error("FAILED TO CREATE ORGANIZATION.", error.message);
      return { organization: null, error: error.message };
    }
  },

  get: async function (clause = {}) {
    try {
      return (await prisma.organizations.findFirst({ where: clause })) || null;
    } catch (error) {
      console.error(error.message);
      return null;
    }
  },

  where: async function (clause = {}, limit = null) {
    try {
      return await prisma.organizations.findMany({
        where: clause,
        ...(limit !== null ? { take: limit } : {}),
      });
    } catch (error) {
      console.error(error.message);
      return [];
    }
  },

  update: async function (id, data = {}) {
    try {
      const organization = await prisma.organizations.update({
        where: { id: Number(id) },
        data: { ...data, lastUpdatedAt: new Date() },
      });
      return { organization, error: null };
    } catch (error) {
      console.error(error.message);
      return { organization: null, error: error.message };
    }
  },

  /**
   * Memberships for a user, newest first. v1 typically has one.
   */
  membershipsForUser: async function (userId) {
    try {
      return await prisma.organization_users.findMany({
        where: { userId: Number(userId) },
        include: { organization: true },
        orderBy: { id: "asc" },
      });
    } catch (error) {
      console.error(error.message);
      return [];
    }
  },

  membership: async function (userId, organizationId) {
    try {
      return (
        (await prisma.organization_users.findFirst({
          where: {
            userId: Number(userId),
            organizationId: Number(organizationId),
          },
          include: { organization: true },
        })) || null
      );
    } catch (error) {
      console.error(error.message);
      return null;
    }
  },

  addMember: async function ({ organizationId, userId, role = "default" }) {
    try {
      const membership = await prisma.organization_users.upsert({
        where: {
          organizationId_userId: {
            organizationId: Number(organizationId),
            userId: Number(userId),
          },
        },
        update: { role },
        create: {
          organizationId: Number(organizationId),
          userId: Number(userId),
          role,
        },
      });
      return { membership, error: null };
    } catch (error) {
      console.error("FAILED TO ADD ORG MEMBER.", error.message);
      return { membership: null, error: error.message };
    }
  },

  updateMemberRole: async function (organizationId, userId, role) {
    try {
      const membership = await prisma.organization_users.update({
        where: {
          organizationId_userId: {
            organizationId: Number(organizationId),
            userId: Number(userId),
          },
        },
        data: { role },
      });
      return { membership, error: null };
    } catch (error) {
      console.error(error.message);
      return { membership: null, error: error.message };
    }
  },

  countAdmins: async function (organizationId) {
    try {
      return await prisma.organization_users.count({
        where: {
          organizationId: Number(organizationId),
          role: "admin",
        },
      });
    } catch (error) {
      console.error(error.message);
      return 0;
    }
  },

  memberUserIds: async function (organizationId) {
    try {
      const rows = await prisma.organization_users.findMany({
        where: { organizationId: Number(organizationId) },
        select: { userId: true, role: true },
      });
      return rows;
    } catch (error) {
      console.error(error.message);
      return [];
    }
  },

  /**
   * Resolve which organization a JWT/session should use.
   * Preference: explicit tenantId if the user is a member, else sole membership.
   */
  resolveForUser: async function (userId, preferredTenantId = null) {
    const memberships = await this.membershipsForUser(userId);
    if (!memberships.length) return { organization: null, membership: null };

    if (preferredTenantId) {
      const match = memberships.find(
        (row) => Number(row.organizationId) === Number(preferredTenantId)
      );
      if (match) {
        return { organization: match.organization, membership: match };
      }
    }

    const sole = memberships[0];
    return { organization: sole.organization, membership: sole };
  },

  public: publicOrganization,

  ensureDefault: async function () {
    let organization = await this.get({ slug: DEFAULT_ORG_SLUG });
    if (!organization) {
      const created = await this.create({
        name: DEFAULT_ORG_NAME,
        slug: DEFAULT_ORG_SLUG,
      });
      organization = created.organization;
    }
    if (organization?.id) setCachedDefaultOrgId(organization.id);
    return organization;
  },
};

module.exports = { Organization };
