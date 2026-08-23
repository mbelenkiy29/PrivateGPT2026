const { ConnectedFileSource } = require("../../models/connectedFileSource");

/**
 * Resolve the ConnectedFileSource used by a knowledge-source adapter.
 * Prefers an explicit record, then config.connectedFileSourceId, then provider.
 * @param {string} provider
 * @param {{ record?: object, config?: object, source?: object }} [opts]
 */
async function resolveConnectedRecord(provider, opts = {}) {
  if (opts.record) return opts.record;

  const config = opts.config || {};
  if (config.connectedFileSourceId) {
    const byId = await ConnectedFileSource.get({
      id: Number(config.connectedFileSourceId),
    });
    if (byId) return byId;
  }

  const key = provider || opts.source?.provider;
  const byProvider = key
    ? await ConnectedFileSource.get({ provider: key })
    : null;
  if (!byProvider) throw new Error(`${key || "File source"} is not connected.`);
  return byProvider;
}

module.exports = { resolveConnectedRecord };
