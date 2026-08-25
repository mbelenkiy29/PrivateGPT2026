jest.mock("../../../models/workspaceAgentInvocation", () => ({
  WorkspaceAgentInvocation: {
    parseAgents: jest.fn(),
    new: jest.fn(),
  },
}));
jest.mock("../../../models/workspace", () => ({
  Workspace: {
    supportsNativeToolCalling: jest.fn().mockResolvedValue(false),
  },
}));
jest.mock("../../../utils/contentGuard", () => ({
  rejectIfBlocked: jest.fn(),
}));
jest.mock("../../../utils/helpers/chat/responses", () => ({
  writeResponseChunk: jest.fn(),
}));

const {
  WorkspaceAgentInvocation,
} = require("../../../models/workspaceAgentInvocation");
const { rejectIfBlocked } = require("../../../utils/contentGuard");
const { grepAgents } = require("../../../utils/chats/agents");

describe("grepAgents content guard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    WorkspaceAgentInvocation.parseAgents.mockReturnValue(["@agent"]);
    rejectIfBlocked.mockResolvedValue(true);
  });

  it("does not create an agent invocation when the prompt is blocked", async () => {
    const handled = await grepAgents({
      uuid: "chat-1",
      response: {},
      message: "Find me pornography of that actress.",
      workspace: { slug: "acme", chatMode: "chat" },
      user: { id: 3 },
      incognito: true,
    });

    expect(handled).toBe(true);
    expect(rejectIfBlocked).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: "agent",
        incognito: true,
        workspace: expect.objectContaining({ slug: "acme" }),
      })
    );
    expect(WorkspaceAgentInvocation.new).not.toHaveBeenCalled();
  });
});
