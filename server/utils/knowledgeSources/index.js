const {
  REQUIRED_METHODS,
  assertAdapter,
  registerAdapter,
  getAdapter,
  listProviders,
  unregisterAdapter,
} = require("./adapter");

// Side-effect register so the Bree worker sees adapters without HTTP routes.
// register.js also auto-loads adapters/*.js; keep these requires for job processes
// that import this module directly.
require("./adapters/gdrive");
require("./adapters/onedrive");
require("./adapters/slack");
require("./adapters/imap");
require("./adapters/gmail-mail");
require("./adapters/outlook-mail");
require("./adapters/notion");
require("./adapters/dropbox");
require("./adapters/sharepoint");
require("./adapters/teams-files");

module.exports = {
  REQUIRED_METHODS,
  assertAdapter,
  registerAdapter,
  getAdapter,
  listProviders,
  unregisterAdapter,
};
