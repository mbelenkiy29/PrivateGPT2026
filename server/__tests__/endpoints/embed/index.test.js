/* eslint-env jest, node */

jest.mock("uuid", () => ({ v4: () => "test-uuid" }), { virtual: true });
jest.mock("../../../utils/http", () => ({
  reqBody: (request) => request.body || {},
  multiUserMode: jest.fn(() => false),
  safeJsonParse: (value, fallback = null) => {
    if (value == null) return fallback;
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  },
}));
jest.mock("../../../utils/helpers/chat/responses", () => ({
  convertToChatHistory: jest.fn(() => []),
  writeResponseChunk: jest.fn(),
}));
jest.mock("../../../utils/chats/embed", () => ({
  streamChatWithForEmbed: jest.fn(),
}));
jest.mock("../../../models/embedChats", () => ({
  EmbedChats: {
    forEmbedByUser: jest.fn(),
    markHistoryInvalid: jest.fn(),
  },
}));
jest.mock("../../../models/embedLead", () => ({
  EmbedLead: { create: jest.fn() },
}));
jest.mock("../../../models/embedHandoff", () => ({
  EmbedHandoff: { create: jest.fn() },
}));
jest.mock("../../../models/telemetry", () => ({
  Telemetry: { sendTelemetry: jest.fn() },
}));
jest.mock("../../../utils/middleware/embedMiddleware", () => ({
  validEmbedConfig: (_req, _res, next) => next(),
  canRespond: (_req, _res, next) => next(),
  setConnectionMeta: (_req, _res, next) => next(),
}));

const {
  embeddedEndpoints,
  publicSmbConfig,
} = require("../../../endpoints/embed");

function collectApp() {
  const routes = {};
  const register = (method) => (path, ...args) => {
    routes[`${method} ${path}`] = args[args.length - 1];
  };
  return {
    app: {
      get: register("GET"),
      post: register("POST"),
      delete: register("DELETE"),
    },
    routes,
  };
}

function mockResponse(locals = {}) {
  return {
    locals,
    statusCode: 200,
    body: null,
    ended: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    sendStatus(code) {
      this.statusCode = code;
      this.ended = true;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}

const secretEmbed = {
  id: 7,
  uuid: "embed-uuid",
  ai_disclosure: true,
  show_handoff: true,
  lead_capture: false,
  grounded_only: true,
  handoff_email: "secret-owner@example.com",
  allowlist_domains: JSON.stringify(["https://allowed.example"]),
  business_hours_json: JSON.stringify({
    timezone: "America/New_York",
    days: [{ day: "mon", open: "09:00", close: "17:00" }],
  }),
  workspace: { openAiKey: "sk-secret", slug: "private-ws" },
};

describe("public embed SMB config", () => {
  it("exposes disclosure text, hours JSON, and flags", () => {
    expect(publicSmbConfig(secretEmbed)).toEqual({
      ai_disclosure: true,
      disclosure_text: "This conversation is handled by an AI assistant.",
      show_handoff: true,
      lead_capture: false,
      grounded_only: true,
      business_hours: {
        timezone: "America/New_York",
        days: [{ day: "mon", open: "09:00", close: "17:00" }],
      },
    });
  });

  it("hides disclosure text when ai_disclosure is off", () => {
    expect(publicSmbConfig({ ...secretEmbed, ai_disclosure: false })).toEqual(
      expect.objectContaining({
        ai_disclosure: false,
        disclosure_text: null,
      })
    );
  });

  it("GET /embed/:embedId/smb-config returns public fields and no secrets", async () => {
    const { app, routes } = collectApp();
    embeddedEndpoints(app);

    const response = mockResponse({ embedConfig: secretEmbed });
    await routes["GET /embed/:embedId/smb-config"]({}, response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      ai_disclosure: true,
      disclosure_text: "This conversation is handled by an AI assistant.",
      show_handoff: true,
      lead_capture: false,
      grounded_only: true,
      business_hours: {
        timezone: "America/New_York",
        days: [{ day: "mon", open: "09:00", close: "17:00" }],
      },
    });
    expect(response.body).not.toHaveProperty("handoff_email");
    expect(response.body).not.toHaveProperty("allowlist_domains");
    expect(response.body).not.toHaveProperty("workspace");
    expect(JSON.stringify(response.body)).not.toContain("secret");
    expect(JSON.stringify(response.body)).not.toContain("sk-");
  });
});
