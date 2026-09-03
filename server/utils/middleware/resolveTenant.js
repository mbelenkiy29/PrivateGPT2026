const { Organization } = require("../../models/organization");
const { userFromSession } = require("../http");
const { currentRole } = require("../tenant");

/**
 * Attach the current organization to the request after auth.
 * Reads JWT tenantId (already decoded via userFromSession / validatedRequest)
 * or the user's sole membership. Overlays membership.role onto the request
 * user so tenant admins are not treated as instance-wide superadmins.
 */
function resolveTenant() {
  return async function resolveTenantMiddleware(request, response, next) {
    try {
      const user =
        response.locals?.user ?? (await userFromSession(request, response));
      if (!user) {
        next();
        return;
      }

      const preferredTenantId =
        request.decodedJwt?.tenantId ||
        response.locals?.jwtTenantId ||
        user.organizationId ||
        null;

      const { organization, membership } = await Organization.resolveForUser(
        user.id,
        preferredTenantId
      );

      if (organization) {
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
      }

      next();
    } catch (error) {
      console.error("resolveTenant", error.message);
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
