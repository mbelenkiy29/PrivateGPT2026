const { safeJsonParse } = require("../http");
const { getLLMProvider } = require("../helpers");

const CLASSIFIER_TIMEOUT_MS = 4000;
const VALID_ACTIONS = new Set(["allow", "block"]);
const VALID_CATEGORIES = new Set([
  "sexual",
  "malware",
  "phishing",
  "other_harm",
  "none",
]);

const SYSTEM_PROMPT = `You classify whether a workplace chat prompt violates content policy.
Return ONLY JSON: {"action":"allow"|"block","category":"sexual"|"malware"|"phishing"|"other_harm"|"none"}.
Block: pornography, sexual content involving minors, malware/virus distribution, phishing or credential theft.
Allow: medical, legal, HR policy, security research discussion without exploit payloads, ordinary work questions.
Never repeat the user text.`;

function parseClassifierResponse(raw = "") {
  let payload = String(raw || "").trim();
  const fenced = payload.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) payload = fenced[1].trim();

  const parsed = safeJsonParse(payload, null);
  if (!parsed || !VALID_ACTIONS.has(parsed.action)) {
    throw new Error("Invalid content-guard classifier response");
  }
  const category = VALID_CATEGORIES.has(parsed.category)
    ? parsed.category
    : "none";
  return { action: parsed.action, category };
}

function defaultConnector() {
  try {
    return getLLMProvider();
  } catch {
    return null;
  }
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function classifyMessage(
  text = "",
  { getConnector = defaultConnector, timeoutMs = CLASSIFIER_TIMEOUT_MS } = {}
) {
  const connector = await getConnector();
  if (!connector || typeof connector.getChatCompletion !== "function") {
    throw new Error("Content-guard classifier is unavailable");
  }

  const completion = await withTimeout(
    connector.getChatCompletion(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: String(text || "").slice(0, 4000) },
      ],
      { temperature: 0 }
    ),
    timeoutMs,
    "Content-guard classifier timed out"
  );

  return parseClassifierResponse(completion?.textResponse);
}

module.exports = {
  classifyMessage,
  parseClassifierResponse,
  CLASSIFIER_TIMEOUT_MS,
};
