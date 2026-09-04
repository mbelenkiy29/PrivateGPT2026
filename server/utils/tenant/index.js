const path = require("path");

const DEFAULT_ORG_SLUG = "default";
const DEFAULT_ORG_NAME = "Default";

function requireOrganizationId(organizationId) {
  if (
    organizationId === undefined ||
    organizationId === null ||
    organizationId === ""
  ) {
    throw new Error("organizationId is required for tenant-scoped queries");
  }
  const id = Number(organizationId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("organizationId is required for tenant-scoped queries");
  }
  return id;
}

/**
 * Merge a Prisma where-clause with a required organizationId.
 * Throws if organizationId is missing so list/get helpers cannot silently
 * return cross-tenant rows.
 * @param {object} clause
 * @param {number|string} organizationId
 * @returns {object}
 */
function assertTenant(clause = {}, organizationId) {
  return {
    ...clause,
    organizationId: requireOrganizationId(organizationId),
  };
}

function slugifyOrgName(name = "workspace") {
  const slugify = require("slugify");
  let slug = slugify(String(name || "workspace"), {
    lower: true,
    strict: true,
    trim: true,
  });
  if (!slug) slug = "org";
  return slug.slice(0, 64);
}

function normalizeEmail(email) {
  if (email === undefined || email === null) return null;
  const value = String(email).trim().toLowerCase();
  return value || null;
}

function emailIsValid(email) {
  const value = normalizeEmail(email);
  if (!value) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function usernameFromEmail(email) {
  const local = String(email || "")
    .split("@")[0]
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
  let username = local;
  if (!username || !/^[a-z]/.test(username)) username = `u${username || "ser"}`;
  if (username.length < 2) username = `${username}user`;
  return username.slice(0, 64);
}

function storageRoot() {
  return process.env.STORAGE_DIR
    ? path.resolve(process.env.STORAGE_DIR)
    : path.resolve(__dirname, "../../storage");
}

/**
 * Tenant-prefixed storage path. The default organization keeps legacy
 * un-prefixed paths so existing self-host files continue to resolve.
 * Other tenants live under tenants/{orgSlug}/...
 */
function tenantPath(organization, ...segments) {
  const root = storageRoot();
  const slug = organization?.slug || DEFAULT_ORG_SLUG;
  if (!slug || slug === DEFAULT_ORG_SLUG) return path.join(root, ...segments);
  return path.join(root, "tenants", slug, ...segments);
}

function documentsPathFor(organization) {
  return tenantPath(organization, "documents");
}

function vectorCachePathFor(organization) {
  return tenantPath(organization, "vector-cache");
}

function generatedImagesPathFor(organization) {
  return tenantPath(organization, "generated-images");
}

let cachedDefaultOrgId = null;

function setCachedDefaultOrgId(id) {
  cachedDefaultOrgId = id == null ? null : Number(id);
}

function getCachedDefaultOrgId() {
  return cachedDefaultOrgId;
}

/**
 * LanceDB table name for a workspace. Default-tenant workspaces keep the
 * historical `workspace.slug` table so existing embeddings still hit.
 * Other tenants are prefixed so two orgs can both use slug `sales`.
 */
function vectorNamespace(workspace) {
  if (!workspace?.slug) return workspace?.slug || null;
  const orgId = workspace.organizationId;
  if (!orgId) return workspace.slug;
  if (
    workspace.organizationSlug === DEFAULT_ORG_SLUG ||
    (cachedDefaultOrgId != null && Number(orgId) === Number(cachedDefaultOrgId))
  ) {
    return workspace.slug;
  }
  return `org${orgId}__${workspace.slug}`;
}

function publicOrganization(organization) {
  if (!organization) return null;
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    status: organization.status,
  };
}

function sessionUserPayload(user, membership = null, organization = null) {
  if (!user) return null;
  const {
    password: _password,
    web_push_subscription_config: _push,
    ...rest
  } = user;
  if (membership?.role) rest.role = membership.role;
  if (organization) {
    rest.organization = publicOrganization(organization);
    rest.organizationId = organization.id;
  }
  return rest;
}

function jwtPayload(user, organization = null) {
  return {
    id: user.id,
    username: user.username,
    tenantId: organization?.id || null,
  };
}

function currentRole(user, membership = null) {
  return membership?.role || user?.role || "default";
}

module.exports = {
  DEFAULT_ORG_SLUG,
  DEFAULT_ORG_NAME,
  requireOrganizationId,
  assertTenant,
  slugifyOrgName,
  normalizeEmail,
  emailIsValid,
  usernameFromEmail,
  storageRoot,
  tenantPath,
  documentsPathFor,
  vectorCachePathFor,
  generatedImagesPathFor,
  setCachedDefaultOrgId,
  getCachedDefaultOrgId,
  vectorNamespace,
  publicOrganization,
  sessionUserPayload,
  jwtPayload,
  currentRole,
};
