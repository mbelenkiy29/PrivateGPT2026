const {
  REQUIRED_METHODS,
  assertAdapter,
  registerAdapter,
  getAdapter,
  listProviders,
  unregisterAdapter,
} = require("./adapter");

// Side-effect register so the Bree worker sees adapters without HTTP routes.
require("./adapters/slack");
require("./adapters/imap");
require("./adapters/gmail-mail");
require("./adapters/outlook-mail");
require("./adapters/notion");
require("./adapters/dropbox");

module.exports = {
  REQUIRED_METHODS,
  assertAdapter,
  registerAdapter,
  getAdapter,
  listProviders,
  unregisterAdapter,
};
