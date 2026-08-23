const fs = require("fs");
const path = require("path");

/**
 * Bree runs jobs as child processes, so adapters registered only in the HTTP
 * server are invisible to the job. Load every adapter file from this folder
 * so both the server and the sync job share the same registry.
 */
const adaptersDir = path.join(__dirname, "adapters");

if (fs.existsSync(adaptersDir)) {
  for (const file of fs.readdirSync(adaptersDir)) {
    if (!file.endsWith(".js")) continue;
    require(path.join(adaptersDir, file));
  }
}
