require("../utils/knowledgeSources/register");
const {
  syncWatchedKnowledgeSources,
} = require("../utils/knowledgeSources/sync");
const { log, conclude } = require("./helpers/index.js");

(async () => {
  try {
    await syncWatchedKnowledgeSources({ log });
  } catch (e) {
    console.error(e);
    log(`errored with ${e.message}`);
  } finally {
    conclude();
  }
})();
