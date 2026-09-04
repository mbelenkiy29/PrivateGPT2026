const { ApiKey } = require("../../models/apiKeys");
const { SystemSettings } = require("../../models/systemSettings");
const { Organization } = require("../../models/organization");

async function validApiKey(request, response, next) {
  const multiUserMode = await SystemSettings.isMultiUserMode();
  response.locals.multiUserMode = multiUserMode;

  const auth = request.header("Authorization");
  const bearerKey = auth ? auth.split(" ")[1] : null;
  if (!bearerKey) {
    response.status(403).json({
      error: "No valid api key found.",
    });
    return;
  }

  const apiKey = await ApiKey.get({ secret: bearerKey });
  if (!apiKey) {
    response.status(403).json({
      error: "No valid api key found.",
    });
    return;
  }

  if (multiUserMode && !apiKey.organizationId) {
    response.status(403).json({
      error: "API key is not bound to an organization.",
    });
    return;
  }

  if (apiKey.organizationId) {
    const organization = await Organization.get({ id: apiKey.organizationId });
    if (!organization || organization.status !== "active") {
      response.status(403).json({
        error: "API key organization is missing or suspended.",
      });
      return;
    }
    response.locals.tenant = organization;
    response.locals.tenantId = organization.id;
  }

  next();
}

module.exports = {
  validApiKey,
};
