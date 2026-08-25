/* eslint-env jest, node */
const {
  normalizeClientChatHistory,
  toAgentHistory,
  persistWorkspaceChat,
} = require("../../../utils/chats/incognito");

jest.mock("../../../models/workspaceChats", () => ({
  WorkspaceChats: { new: jest.fn() },
}));

const { WorkspaceChats } = require("../../../models/workspaceChats");

describe("normalizeClientChatHistory", () => {
  it("keeps user/assistant turns and drops pending or empty rows", () => {
    const { chatHistory } = normalizeClientChatHistory(
      [
        { role: "user", content: "hello" },
        { role: "assistant", content: "hi", pending: true },
        { role: "assistant", content: "" },
        { role: "status", content: "working" },
        { role: "assistant", content: "there" },
      ],
      20
    );
    expect(chatHistory).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "there" },
    ]);
  });

  it("caps to the message-pair limit", () => {
    const rows = [];
    for (let i = 0; i < 6; i++) {
      rows.push({ role: "user", content: `u${i}` });
      rows.push({ role: "assistant", content: `a${i}` });
    }
    const { chatHistory } = normalizeClientChatHistory(rows, 2);
    expect(chatHistory.map((m) => m.content)).toEqual(["u4", "a4", "u5", "a5"]);
  });
});

describe("toAgentHistory", () => {
  it("maps roles onto AIbitat from/to", () => {
    expect(
      toAgentHistory([
        { role: "user", content: "go" },
        { role: "assistant", content: "ok" },
      ])
    ).toEqual([
      { from: "USER", to: "@agent", content: "go", state: "success" },
      { from: "@agent", to: "USER", content: "ok", state: "success" },
    ]);
  });
});

describe("persistWorkspaceChat", () => {
  beforeEach(() => jest.clearAllMocks());

  it("skips the database when incognito", async () => {
    const result = await persistWorkspaceChat(true, { prompt: "secret" });
    expect(result).toEqual({ chat: { id: null } });
    expect(WorkspaceChats.new).not.toHaveBeenCalled();
  });

  it("writes through when not incognito", async () => {
    WorkspaceChats.new.mockResolvedValue({ chat: { id: 7 } });
    const result = await persistWorkspaceChat(false, { prompt: "hi" });
    expect(WorkspaceChats.new).toHaveBeenCalledWith({ prompt: "hi" });
    expect(result).toEqual({ chat: { id: 7 } });
  });
});
