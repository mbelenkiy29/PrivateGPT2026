/* eslint-env jest, node */

jest.mock("uuid", () => ({ v4: () => "test-uuid" }), { virtual: true });
jest.mock("../../../utils/helpers/chat", () => ({
  fillSourceWindow: jest.fn(({ searchResults = [] }) => ({
    sources: searchResults,
    contextTexts: searchResults.map((src) => src.text).filter(Boolean),
  })),
}));
jest.mock("../../../utils/helpers", () => ({
  getVectorDbClass: jest.fn(),
  resolveProviderConnector: jest.fn(),
}));
jest.mock("../../../utils/helpers/modelPricing", () => ({
  addChatCostToMetrics: jest.fn((metrics) => metrics),
}));
jest.mock("../../../utils/chats/index", () => ({
  chatPrompt: jest.fn().mockResolvedValue("system"),
  sourceIdentifier: jest.fn((doc) => doc?.id || "src"),
}));
jest.mock("../../../models/embedChats", () => ({
  EmbedChats: {
    new: jest.fn(),
    forEmbedByUser: jest.fn(),
    count: jest.fn(),
  },
}));
jest.mock("../../../models/embedUnanswered", () => ({
  EmbedUnanswered: { create: jest.fn() },
}));
jest.mock("../../../utils/helpers/chat/responses", () => ({
  convertToPromptHistory: jest.fn(() => []),
  writeResponseChunk: jest.fn(),
}));
jest.mock("../../../utils/helpers/abortSignals", () => ({
  abortConnectorOnClientDisconnect: jest.fn(),
}));
jest.mock("../../../utils/DocumentManager", () => ({
  DocumentManager: jest.fn().mockImplementation(() => ({
    pinnedDocs: jest.fn().mockResolvedValue([]),
  })),
}));

const { getVectorDbClass, resolveProviderConnector } = require("../../../utils/helpers");
const { streamChatWithForEmbed } = require("../../../utils/chats/embed");
const { EmbedChats } = require("../../../models/embedChats");
const { EmbedUnanswered } = require("../../../models/embedUnanswered");
const {
  writeResponseChunk,
} = require("../../../utils/helpers/chat/responses");

const REFUSAL = "No relevant workspace documents for that.";

function makeEmbed(overrides = {}) {
  return {
    id: 11,
    chat_mode: "chat",
    grounded_only: false,
    allow_model_override: false,
    allow_prompt_override: false,
    allow_temperature_override: false,
    message_limit: 20,
    workspace: {
      slug: "support",
      queryRefusalResponse: REFUSAL,
      similarityThreshold: 0.25,
      topN: 4,
      vectorSearchMode: "default",
      openAiTemp: 0.7,
    },
    ...overrides,
  };
}

function fakeConnector(overrides = {}) {
  return {
    constructor: { name: "FakeLLM" },
    promptWindowLimit: () => 8000,
    streamingEnabled: () => false,
    compressMessages: jest.fn().mockResolvedValue([]),
    getChatCompletion: jest.fn().mockResolvedValue({
      textResponse: "general knowledge answer",
      metrics: {},
    }),
    ...overrides,
  };
}

function mockEmptyNamespace() {
  getVectorDbClass.mockReturnValue({
    hasNamespace: jest.fn().mockResolvedValue(false),
    namespaceCount: jest.fn().mockResolvedValue(0),
    performSimilaritySearch: jest.fn(),
  });
}

function mockEmptySearch() {
  getVectorDbClass.mockReturnValue({
    hasNamespace: jest.fn().mockResolvedValue(true),
    namespaceCount: jest.fn().mockResolvedValue(4),
    performSimilaritySearch: jest.fn().mockResolvedValue({
      contextTexts: [],
      sources: [],
      message: null,
    }),
  });
}

describe("embed chat grounded-only and unanswered logging", () => {
  const response = { locals: {} };

  beforeEach(() => {
    jest.clearAllMocks();
    EmbedChats.forEmbedByUser.mockResolvedValue([]);
    EmbedChats.count.mockResolvedValue(0);
    EmbedChats.new.mockResolvedValue({ chat: { id: 1 } });
    EmbedUnanswered.create.mockResolvedValue({ id: 1 });
    resolveProviderConnector.mockResolvedValue({
      connector: fakeConnector(),
      routingMetadata: null,
      prefetchedContext: { pinnedDocs: [] },
      error: null,
    });
  });

  it("forces query mode when grounded_only and logs unanswered on empty retrieval", async () => {
    mockEmptyNamespace();
    const embed = makeEmbed({ chat_mode: "chat", grounded_only: true });

    await streamChatWithForEmbed(
      response,
      embed,
      "What is the refund policy?",
      "session-1",
      {}
    );

    expect(EmbedUnanswered.create).toHaveBeenCalledWith({
      embed_id: 11,
      session_id: "session-1",
      question: "What is the refund policy?",
    });
    expect(writeResponseChunk).toHaveBeenCalledWith(
      response,
      expect.objectContaining({
        type: "textResponse",
        textResponse: REFUSAL,
        sources: [],
        close: true,
        error: null,
      })
    );
    expect(EmbedChats.new).not.toHaveBeenCalled();
  });

  it("does not refuse chat-mode embeds when grounded_only is off", async () => {
    mockEmptyNamespace();
    const embed = makeEmbed({ chat_mode: "chat", grounded_only: false });

    await streamChatWithForEmbed(
      response,
      embed,
      "What is the refund policy?",
      "session-1",
      {}
    );

    expect(EmbedUnanswered.create).not.toHaveBeenCalled();
    expect(writeResponseChunk).toHaveBeenCalledWith(
      response,
      expect.objectContaining({
        textResponse: "general knowledge answer",
        close: true,
      })
    );
  });

  it("logs unanswered and uses workspace queryRefusalResponse on empty search", async () => {
    mockEmptySearch();
    const embed = makeEmbed({ chat_mode: "query", grounded_only: false });

    await streamChatWithForEmbed(
      response,
      embed,
      "Do you offer overnight shipping?",
      "session-9",
      {}
    );

    expect(EmbedUnanswered.create).toHaveBeenCalledWith({
      embed_id: 11,
      session_id: "session-9",
      question: "Do you offer overnight shipping?",
    });
    expect(writeResponseChunk).toHaveBeenCalledWith(
      response,
      expect.objectContaining({
        type: "textResponse",
        textResponse: REFUSAL,
        close: true,
        error: null,
      })
    );
    expect(EmbedChats.new).not.toHaveBeenCalled();
  });
});
