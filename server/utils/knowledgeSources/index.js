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

module.exports = {
  REQUIRED_METHODS,
  assertAdapter,
  registerAdapter,
  getAdapter,
  listProviders,
  unregisterAdapter,
};
