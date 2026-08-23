/* eslint-env jest, node */

jest.mock("uuid", () => ({ v4: () => "id", validate: () => true }), {
  virtual: true,
});
jest.mock("../../../utils/chats/stream", () => ({
  VALID_CHAT_MODE: ["chat", "query", "automatic"],
}));
jest.mock("../../../models/embedChats", () => ({
  EmbedChats: { count: jest.fn() },
}));
jest.mock("../../../models/embedConfig", () => ({
  EmbedConfig: { parseAllowedHosts: jest.fn(() => null) },
}));
jest.mock("../../../utils/http", () => ({
  reqBody: (request) => request.body || {},
}));

const { canRespond } = require("../../../utils/middleware/embedMiddleware");
const { EmbedChats } = require("../../../models/embedChats");

function mockResponse(embed) {
  return {
    locals: { embedConfig: embed },
    statusCode: 200,
    body: null,
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
      return this;
    },
    end() {
      return this;
    },
  };
}

const cappedEmbed = {
  id: 4,
  enabled: true,
  chat_mode: "query",
  max_chats_per_day: 1,
  max_chats_per_session: 1,
};

describe("canRespond chat cap vs smb-config GET", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    EmbedChats.count.mockResolvedValue(9);
  });

  it("does not apply max_chats_per_day to GET smb-config", async () => {
    const next = jest.fn();
    const response = mockResponse(cappedEmbed);

    await canRespond(
      { method: "GET", path: "/embed/abc/smb-config", headers: {}, body: {} },
      response,
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(EmbedChats.count).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(200);
  });

  it("still rate-limits POST lead/handoff after the chat cap", async () => {
    const next = jest.fn();
    const response = mockResponse(cappedEmbed);

    await canRespond(
      {
        method: "POST",
        path: "/embed/abc/lead",
        headers: {},
        body: { session_id: "11111111-1111-4111-8111-111111111111" },
      },
      response,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(429);
    expect(response.body.error).toBe("Rate limit exceeded");
  });
});
