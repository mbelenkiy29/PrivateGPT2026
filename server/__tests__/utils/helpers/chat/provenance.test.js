/* eslint-env jest */
global.fetch = jest.fn().mockResolvedValue({
  status: 304,
  headers: { get: () => null },
  json: async () => ({}),
});

const { FREE_PROVIDERS } = require("../../../../utils/helpers/modelPricing");

const mockCreate = jest.fn().mockResolvedValue({ id: 1 });

jest.mock("../../../../models/usageEvent", () => ({
  UsageEvent: {
    sources: {
      chat: "chat",
      embed: "embed",
      agent: "agent",
      channel: "channel",
    },
    create: (...args) => mockCreate(...args),
  },
}));

const {
  isLocalProvider,
  buildProvenance,
  withProvenance,
  decorateChatResponse,
  DESTINATIONS,
} = require("../../../../utils/helpers/chat/provenance");

describe("local vs cloud classification", () => {
  const originalProvider = process.env.LLM_PROVIDER;

  afterEach(() => {
    process.env.LLM_PROVIDER = originalProvider;
    mockCreate.mockClear();
  });

  test("FREE_PROVIDERS are local and destination is this-server", () => {
    expect(FREE_PROVIDERS.length).toBeGreaterThan(0);
    for (const provider of FREE_PROVIDERS) {
      expect(isLocalProvider(provider)).toBe(true);
      expect(buildProvenance({ provider, model: "llama3" })).toEqual(
        expect.objectContaining({
          provider,
          model: "llama3",
          local: true,
          destination: DESTINATIONS.local,
        })
      );
    }
  });

  test("cloud providers are not local and destination is named-cloud", () => {
    for (const provider of ["openai", "anthropic", "gemini", "openrouter"]) {
      expect(isLocalProvider(provider)).toBe(false);
      expect(buildProvenance({ provider, model: "gpt-4o" })).toEqual(
        expect.objectContaining({
          provider,
          local: false,
          destination: DESTINATIONS.cloud,
        })
      );
    }
  });

  test("unknown providers are treated as cloud", () => {
    expect(isLocalProvider("not-a-provider")).toBe(false);
    expect(buildProvenance({ provider: "not-a-provider" }).destination).toBe(
      DESTINATIONS.cloud
    );
  });

  test("withProvenance attaches provenance without dropping existing fields", () => {
    const decorated = withProvenance(
      { text: "hello", sources: [{ title: "Doc", text: "long body" }] },
      { provider: "ollama", model: "llama3" }
    );
    expect(decorated.text).toBe("hello");
    expect(decorated.provenance).toEqual({
      provider: "ollama",
      model: "llama3",
      local: true,
      destination: "this-server",
      sources: [{ id: null, title: "Doc", chunkSource: null }],
    });
  });

  test("decorateChatResponse records a usage event with local=true for ollama", async () => {
    const response = await decorateChatResponse(
      {
        text: "ok",
        sources: [],
        metrics: { prompt_tokens: 10, completion_tokens: 4, totalCost: 0 },
      },
      {
        provider: "ollama",
        model: "llama3",
        source: "chat",
        workspaceId: 7,
        userId: 3,
      }
    );

    expect(response.provenance.local).toBe(true);
    expect(response.provenance.destination).toBe("this-server");
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 7,
        userId: 3,
        provider: "ollama",
        model: "llama3",
        local: true,
        prompt_tokens: 10,
        completion_tokens: 4,
        cost_usd: 0,
        source: "chat",
      })
    );
  });

  test("decorateChatResponse records a usage event with local=false for openai", async () => {
    await decorateChatResponse(
      {
        text: "ok",
        metrics: { prompt_tokens: 8, completion_tokens: 2, totalCost: 0.001 },
      },
      {
        provider: "openai",
        model: "gpt-4o",
        source: "embed",
        workspaceId: 1,
      }
    );

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai",
        model: "gpt-4o",
        local: false,
        cost_usd: 0.001,
        source: "embed",
      })
    );
  });
});
