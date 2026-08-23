/* eslint-env jest, node */

jest.mock("../../../models/embedChats", () => ({
  EmbedChats: {},
}));
jest.mock("../../../models/embedConfig", () => ({
  EmbedConfig: {},
}));
jest.mock("../../../models/eventLogs", () => ({
  EventLogs: { logEvent: jest.fn() },
}));
jest.mock("../../../utils/http", () => ({
  reqBody: (request) => request.body || {},
  userFromSession: jest.fn(),
}));
jest.mock("../../../utils/middleware/embedMiddleware", () => ({
  validEmbedConfigId: (_req, _res, next) => next(),
}));
jest.mock("../../../utils/middleware/multiUserProtected", () => ({
  flexUserRoleValid: () => (_req, _res, next) => next(),
  ROLES: { admin: "admin" },
}));
jest.mock("../../../utils/middleware/validatedRequest", () => ({
  validatedRequest: (_req, _res, next) => next(),
}));
jest.mock("../../../utils/middleware/chatHistoryViewable", () => ({
  chatHistoryViewable: (_req, _res, next) => next(),
}));
jest.mock("../../../models/embedLead", () => ({
  EmbedLead: { whereWithEmbed: jest.fn(), count: jest.fn() },
}));
jest.mock("../../../models/embedHandoff", () => ({
  EmbedHandoff: { whereWithEmbed: jest.fn(), count: jest.fn() },
}));
jest.mock("../../../models/embedUnanswered", () => ({
  EmbedUnanswered: { whereWithEmbed: jest.fn(), count: jest.fn() },
}));

const {
  embedManagementEndpoints,
} = require("../../../endpoints/embedManagement");
const { EmbedLead } = require("../../../models/embedLead");
const { EmbedHandoff } = require("../../../models/embedHandoff");
const { EmbedUnanswered } = require("../../../models/embedUnanswered");

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

function mockResponse() {
  return {
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
      this.ended = true;
      return this;
    },
  };
}

describe("embed SMB admin lists", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("lists unanswered questions with workspace names", async () => {
    const rows = [
      {
        id: 1,
        question: "Do you ship to Alaska?",
        embed_config: { workspace: { name: "Support" } },
      },
    ];
    EmbedUnanswered.whereWithEmbed.mockResolvedValue(rows);
    EmbedUnanswered.count.mockResolvedValue(1);

    const { app, routes } = collectApp();
    embedManagementEndpoints(app);
    const response = mockResponse();
    await routes["POST /embed/unanswered"]({ body: { offset: 0 } }, response);

    expect(EmbedUnanswered.whereWithEmbed).toHaveBeenCalledWith(
      {},
      20,
      { id: "desc" },
      0
    );
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({
      unanswered: rows,
      hasPages: false,
      total: 1,
    });
  });

  it("lists leads and handoffs", async () => {
    EmbedLead.whereWithEmbed.mockResolvedValue([{ id: 9, email: "a@b.c" }]);
    EmbedLead.count.mockResolvedValue(21);
    EmbedHandoff.whereWithEmbed.mockResolvedValue([
      { id: 3, session_id: "abc", status: "open" },
    ]);
    EmbedHandoff.count.mockResolvedValue(1);

    const { app, routes } = collectApp();
    embedManagementEndpoints(app);

    const leadsRes = mockResponse();
    await routes["POST /embed/leads"]({ body: { offset: 0 } }, leadsRes);
    expect(EmbedLead.whereWithEmbed).toHaveBeenCalledWith(
      {},
      20,
      { id: "desc" },
      0
    );
    expect(leadsRes.body.hasPages).toBe(true);
    expect(leadsRes.body.leads).toHaveLength(1);

    const handoffRes = mockResponse();
    await routes["POST /embed/handoffs"]({ body: {} }, handoffRes);
    expect(handoffRes.body.handoffs[0].status).toBe("open");
  });
});
