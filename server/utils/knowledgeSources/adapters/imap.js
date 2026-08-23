const { registerAdapter } = require("../adapter");
const { listImapMessages } = require("../imapClient");
const {
  DELTA_CAP,
  WATCH_HINT,
  mailDownloadPayload,
  capItems,
  resolveConfig,
  registerWatchType,
} = require("../mail");

/**
 * @param {object} [options]
 * @param {object} [options.config] encrypted knowledge_sources config (host/user/password)
 * @param {Function} [options.listMessages] injectable IMAP listing for tests
 */
function createImapAdapter({ config = {}, listMessages } = {}) {
  const listFn = listMessages || listImapMessages;
  let boundConfig = { ...config };

  async function collect(opts = {}, cursor) {
    const cfg = resolveConfig(opts, boundConfig);
    boundConfig = cfg;
    const result = await listFn(cfg, {
      cursor: cursor ?? opts.cursor ?? null,
      limit: DELTA_CAP,
    });
    const items = capItems(result?.items || [], DELTA_CAP);
    return { items, cursor: result?.cursor || cursor || null };
  }

  return {
    async list(opts = {}) {
      return collect(opts, opts.cursor);
    },
    async download(item) {
      return mailDownloadPayload(item);
    },
    async delta(cursor, extra = {}) {
      const opts =
        cursor && typeof cursor === "object" && cursor.config
          ? cursor
          : { ...extra, cursor };
      return collect(opts, opts.cursor ?? cursor);
    },
    watchHint() {
      return { ...WATCH_HINT };
    },
    toChunkSource(item = {}) {
      return `imap://${item.uid || item.id || ""}`;
    },
  };
}

const adapter = createImapAdapter();
registerAdapter("imap", adapter);
registerWatchType("imap");

module.exports = adapter;
module.exports.createImapAdapter = createImapAdapter;
module.exports.PROVIDER = "imap";
