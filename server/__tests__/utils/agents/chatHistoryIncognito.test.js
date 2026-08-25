/* eslint-env jest, node */

jest.mock("../../../models/workspaceChats", () => ({
  WorkspaceChats: { new: jest.fn(), upsert: jest.fn() },
}));
jest.mock("../../../models/workspaceThread", () => ({
  WorkspaceThread: { get: jest.fn(), autoRenameThread: jest.fn() },
}));
jest.mock("../../../models/usageEvent", () => ({
  UsageEvent: { sources: { agent: "agent" } },
}));
jest.mock("../../../utils/helpers/chat/provenance", () => ({
  decorateChatResponse: jest.fn(async (payload) => payload),
}));

const { chatHistory } = require("../../../utils/agents/aibitat/plugins/chat-history");

describe("chat-history plugin incognito", () => {
  it("does not register persist listeners when incognito", () => {
    const plugin = chatHistory.plugin();
    const aibitat = {
      handlerProps: { incognito: true },
      onAbort: jest.fn(),
      onMessage: jest.fn(),
    };
    plugin.setup(aibitat);
    expect(aibitat.onAbort).toHaveBeenCalledTimes(1);
    expect(aibitat.onMessage).not.toHaveBeenCalled();
  });

  it("registers persist listeners for normal sessions", () => {
    const plugin = chatHistory.plugin();
    const aibitat = {
      handlerProps: { incognito: false },
      onAbort: jest.fn(),
      onMessage: jest.fn(),
    };
    plugin.setup(aibitat);
    expect(aibitat.onMessage).toHaveBeenCalled();
  });
});
