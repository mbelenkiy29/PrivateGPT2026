const {
  REQUIRED_METHODS,
  assertAdapter,
  registerAdapter,
  getAdapter,
  listProviders,
  unregisterAdapter,
} = require("./adapter");

// Self-registering adapters. Required here so the Bree job process
// (which loads this module) can resolve getAdapter("notion"|"dropbox").
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
