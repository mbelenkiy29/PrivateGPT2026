const { Organization } = require("../../models/organization");
const { userFromSession } = require("../http");
const { currentRole } = require("../tenant");

function deny(response, status, error) {
  response.status(status).json({ error });
}

function preferredTenantIdFrom(request, response) {
  const decoded =
    request.decodedJwt ||
    (response.locals?.jwtTenantId != null
      ? { tenantId: response.locals.jwtTenantId }
      : null);
  if (decoded?.tenantId) return decoded.tenantId;
  return null;
}

/**
 * Bind the request to one active organization after auth.
 *
 * B2B session rules (Clerk-style active org + membership):
 * - Authenticated multi-user requests must have an organization.
 * - JWT tenantId is only used when the user is a member of that org.
 * - A foreign/stale tenantId does not fall back to another org.
 * - Suspended organizations cannot be selected.
 */
function resolveTenant({ required = true } = {}) {
  return async function resolveTenantMiddleware(request, response, next) {
    try {
      const user =
        response.locals?.user ?? (await userFromSession(request, response));
      if (!user) {
        if (required && response.locals?.multiUserMode) {
          deny(response, 401, "No auth token found.");
          return;
        }
        next();
        return;
      }

      const preferredTenantId = preferredTenantIdFrom(request, response);
      const { organization, membership } = await Organization.resolveForUser(
        user.id,
        preferredTenantId,
        { requirePreferred: Boolean(preferredTenantId) }
      );

      if (!organization || !membership) {
        if (required) {
          deny(
            response,
            403,
            preferredTenantId
              ? "Not a member of the organization in this session."
              : "No organization membership for this session."
          );
          return;
        }
        next();
        return;
      }

      if (organization.status && organization.status !== "active") {
        deny(response, 403, "Organization is suspended.");
        return;
      }

      const role = currentRole(user, membership);
      response.locals.tenant = organization;
      response.locals.tenantId = organization.id;
      response.locals.membership = membership;
      response.locals.user = {
        ...user,
        role,
        organizationId: organization.id,
        organization,
      };

      next();
    } catch (error) {
      console.error("resolveTenant", error.message);
      if (required) {
        deny(response, 403, "Unable to resolve tenant.");
        return;
      }
      next();
    }
  };
}

function tenantIdFrom(response) {
  return response?.locals?.tenantId || response?.locals?.tenant?.id || null;
}

function requireTenant(response) {
  const tenantId = tenantIdFrom(response);
  if (!tenantId) {
    const err = new Error("No tenant context");
    err.status = 403;
    throw err;
  }
  return Number(tenantId);
}

module.exports = {
  resolveTenant,
  tenantIdFrom,
  requireTenant,
};
