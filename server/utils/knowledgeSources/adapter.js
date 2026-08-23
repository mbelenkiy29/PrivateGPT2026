/**
 * @typedef {Object} KnowledgeSourceListResult
 * @property {object[]} items
 * @property {string|null} [cursor]
 */

/**
 * @typedef {Object} KnowledgeSourceDeltaResult
 * @property {object[]} items - Changed remote items since the given cursor.
 *   Entries with `deleted: true` were removed remotely and must be unembedded;
 *   the rest are upserts. Adapters may also set `archived` on Notion pages.
 * @property {string|null} [cursor]
 */

/**
 * Provider adapter contract for knowledge sources (Drive, Slack, Notion, etc.).
 *
 * @typedef {Object} KnowledgeSourceAdapter
 * @property {(opts: { cursor?: string|null, folderId?: string|null }) => Promise<KnowledgeSourceListResult>} list
 * @property {(item: object) => Promise<object>} download
 * @property {(cursor?: string|null) => Promise<KnowledgeSourceDeltaResult>} delta
 * @property {() => object} watchHint
 * @property {(item: object) => string} toChunkSource
 */

const REQUIRED_METHODS = [
  "list",
  "download",
  "delta",
  "watchHint",
  "toChunkSource",
];

/** @type {Map<string, KnowledgeSourceAdapter>} */
const adapters = new Map();

/**
 * Throw if `adapter` is missing any required contract methods.
 * @param {object} adapter
 * @returns {asserts adapter is KnowledgeSourceAdapter}
 */
function assertAdapter(adapter) {
  if (!adapter || typeof adapter !== "object")
    throw new Error("Knowledge source adapter must be an object");

  const missing = REQUIRED_METHODS.filter(
    (method) => typeof adapter[method] !== "function"
  );
  if (missing.length > 0) {
    throw new Error(
      `Knowledge source adapter missing required methods: ${missing.join(", ")}`
    );
  }
}

/**
 * @param {string} provider
 * @param {KnowledgeSourceAdapter} adapter
 */
function registerAdapter(provider, adapter) {
  if (!provider) throw new Error("Knowledge source provider is required");
  assertAdapter(adapter);
  adapters.set(String(provider), adapter);
}

/**
 * @param {string} provider
 * @returns {KnowledgeSourceAdapter|null}
 */
function getAdapter(provider) {
  return adapters.get(String(provider)) || null;
}

/**
 * @returns {string[]}
 */
function listProviders() {
  return Array.from(adapters.keys());
}

/**
 * @param {string} provider
 */
function unregisterAdapter(provider) {
  adapters.delete(String(provider));
}

module.exports = {
  REQUIRED_METHODS,
  assertAdapter,
  registerAdapter,
  getAdapter,
  listProviders,
  unregisterAdapter,
};
