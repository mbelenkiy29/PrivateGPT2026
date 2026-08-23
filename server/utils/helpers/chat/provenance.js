const { FREE_PROVIDERS } = require("../modelPricing");
const { UsageEvent } = require("../../../models/usageEvent");

const DESTINATIONS = {
  local: "this-server",
  cloud: "named-cloud",
};

function isLocalProvider(provider) {
  return FREE_PROVIDERS.includes(provider);
}

/**
 * Resolve the AnythingLLM provider slug and model id used for a completion.
 * Matches addChatCostToMetrics: router result, then workspace, then env.
 */
function resolveProviderAndModel({
  routingMetadata = null,
  workspace = null,
  connector = null,
  provider = null,
  model = null,
} = {}) {
  return {
    provider:
      provider ??
      routingMetadata?.routedTo?.provider ??
      workspace?.chatProvider ??
      process.env.LLM_PROVIDER ??
      null,
    model:
      model ??
      routingMetadata?.routedTo?.model ??
      workspace?.chatModel ??
      connector?.model ??
      null,
  };
}

function compactSources(sources = []) {
  if (!Array.isArray(sources)) return [];
  return sources.map((source) => {
    if (source == null || typeof source !== "object") return source;
    return {
      id: source.id ?? source.docId ?? null,
      title: source.title ?? source.filename ?? source.name ?? null,
      chunkSource: source.chunkSource ?? source.url ?? null,
    };
  });
}

/**
 * @returns {{ provider: string|null, model: string|null, local: boolean, sources: object[], destination: "this-server"|"named-cloud" }}
 */
function buildProvenance({ provider = null, model = null, sources = [] } = {}) {
  const local = isLocalProvider(provider);
  return {
    provider: provider ?? null,
    model: model ?? null,
    local,
    sources: compactSources(sources),
    destination: local ? DESTINATIONS.local : DESTINATIONS.cloud,
  };
}

function withProvenance(response = {}, opts = {}) {
  const { provider, model } = resolveProviderAndModel(opts);
  return {
    ...response,
    provenance: buildProvenance({
      provider,
      model,
      sources: opts.sources ?? response.sources ?? [],
    }),
  };
}

async function recordUsageEvent({
  workspaceId = null,
  userId = null,
  source = UsageEvent.sources.chat,
  metrics = {},
  ...providerOpts
} = {}) {
  const { provider, model } = resolveProviderAndModel(providerOpts);
  try {
    await UsageEvent.create({
      workspaceId,
      userId,
      provider,
      model,
      local: isLocalProvider(provider),
      prompt_tokens: metrics?.prompt_tokens,
      completion_tokens: metrics?.completion_tokens,
      cost_usd: metrics?.totalCost,
      source,
    });
  } catch (error) {
    console.error("Failed to record usage event", error.message);
  }
}

/**
 * Attach provenance to the stored chat response JSON and write a usage_events row.
 * Usage write failures never block the chat save.
 */
async function decorateChatResponse(response = {}, opts = {}) {
  const decorated = withProvenance(response, opts);
  await recordUsageEvent({
    ...opts,
    metrics: opts.metrics ?? response.metrics,
  });
  return decorated;
}

module.exports = {
  DESTINATIONS,
  isLocalProvider,
  resolveProviderAndModel,
  buildProvenance,
  withProvenance,
  recordUsageEvent,
  decorateChatResponse,
};
