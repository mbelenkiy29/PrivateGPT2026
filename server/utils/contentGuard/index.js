const { evaluateRules, VERDICT } = require("./rules");
const { classifyMessage } = require("./classifier");
const { logBlock, logClassifierError, sanitizeAudit } = require("./audit");
const { SystemSettings } = require("../../models/systemSettings");
const { EventLogs } = require("../../models/eventLogs");
const { writeResponseChunk } = require("../helpers/chat/responses");

const BLOCK_ERROR = "This message was blocked by the instance content policy.";

function publicResult({ action, category, source, urlCount }) {
  return sanitizeAudit({ action, category, source, urlCount });
}

async function guardEnabled(isEnabled) {
  if (typeof isEnabled === "function") return !!(await isEnabled());
  if (typeof isEnabled === "boolean") return isEnabled;
  const value = await SystemSettings.getValueOrFallback(
    { label: "content_guard_enabled" },
    "true"
  );
  return value !== "false";
}

/**
 * Inspect a user prompt before any model or agent sees it.
 * Never returns the original text (or snippets) on the result object.
 *
 * @param {object} params
 * @param {string} params.text
 * @param {Function} [params.classify]
 * @param {Function|boolean} [params.isEnabled]
 * @returns {Promise<{action:"allow"|"block", category:string, source:string, urlCount:number}>}
 */
async function inspect({
  text = "",
  classify = classifyMessage,
  isEnabled,
} = {}) {
  if (!(await guardEnabled(isEnabled))) {
    return publicResult({
      action: "allow",
      category: "none",
      source: "disabled",
      urlCount: 0,
    });
  }

  const rules = evaluateRules(text);
  if (rules.verdict === VERDICT.BLOCK) {
    return publicResult({
      action: "block",
      category: rules.category,
      source: "rules",
      urlCount: rules.urlCount,
    });
  }

  if (rules.verdict === VERDICT.ALLOW) {
    return publicResult({
      action: "allow",
      category: "none",
      source: "rules",
      urlCount: rules.urlCount,
    });
  }

  try {
    const classified = await classify(text, { categoryHint: rules.category });
    const action = classified?.action === "block" ? "block" : "allow";
    return publicResult({
      action,
      category:
        action === "block"
          ? classified?.category || rules.category
          : rules.category,
      source: "classifier",
      urlCount: rules.urlCount,
    });
  } catch {
    return publicResult({
      action: "allow",
      category: rules.category,
      source: "classifier_error",
      urlCount: rules.urlCount,
    });
  }
}

/**
 * Abort a streamed chat when the prompt is blocked.
 * @returns {Promise<boolean>} true when the request was blocked
 */
async function rejectIfBlocked({
  text,
  user = null,
  workspace = null,
  incognito = false,
  surface = "workspace_chat",
  response = null,
  uuid = null,
  classify,
  isEnabled,
  logEvent = EventLogs.logEvent.bind(EventLogs),
} = {}) {
  const result = await inspect({ text, classify, isEnabled });
  if (result.action !== "block") {
    if (result.source === "classifier_error") {
      await logClassifierError(
        {
          surface,
          workspaceSlug: workspace?.slug || null,
          incognito: !!incognito,
        },
        user?.id,
        logEvent
      );
    }
    return false;
  }

  await logBlock(
    {
      category: result.category,
      source: result.source,
      surface,
      workspaceSlug: workspace?.slug || null,
      incognito: !!incognito,
      urlCount: result.urlCount,
    },
    user?.id,
    logEvent
  );

  if (response && uuid) {
    writeResponseChunk(response, {
      id: uuid,
      type: "abort",
      textResponse: null,
      sources: [],
      close: true,
      error: BLOCK_ERROR,
    });
  }

  return true;
}

module.exports = {
  inspect,
  rejectIfBlocked,
  BLOCK_ERROR,
};
