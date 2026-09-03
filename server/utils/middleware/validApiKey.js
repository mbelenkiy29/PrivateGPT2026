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

  if (apiKey.organizationId) {
    const organization = await Organization.get({ id: apiKey.organizationId });
    if (organization) {
      response.locals.tenant = organization;
      response.locals.tenantId = organization.id;
    }
  }

  next();
}

module.exports = {
  validApiKey,
};
