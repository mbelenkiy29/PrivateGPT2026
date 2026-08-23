const { KnowledgeSource } = require("../models/knowledgeSource");
const { getAdapter } = require("../utils/knowledgeSources");
const { log, conclude } = require("./helpers/index.js");

(async () => {
  try {
    const sources = await KnowledgeSource.where({ watch_enabled: true });
    if (sources.length === 0) {
      log("No watched knowledge sources to sync. Exiting.");
      return;
    }

    log(
      `${sources.length} watched knowledge source(s) found; checking adapters.`
    );
    for (const source of sources) {
      const adapter = getAdapter(source.provider);
      if (!adapter) {
        log(
          `Skipping knowledge source ${source.id} (${source.provider}): no adapter registered.`
        );
        continue;
      }

      log(
        `Knowledge source ${source.id} (${source.provider}) adapter present; sync not implemented.`
      );
    }
  } catch (e) {
    console.error(e);
    log(`errored with ${e.message}`);
  } finally {
    conclude();
  }
})();
