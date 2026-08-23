/* eslint-env jest */

const mockChatRetentionDays = jest.fn();
const mockWorkspaceDelete = jest.fn().mockResolvedValue(true);
const mockEmbedDelete = jest.fn().mockResolvedValue(true);

jest.mock("../../jobs/helpers", () => ({
  log: jest.fn(),
  conclude: jest.fn(),
}));
jest.mock("../../models/systemSettings", () => ({
  SystemSettings: {
    DEFAULT_CHAT_RETENTION_DAYS: 90,
    chatRetentionDays: (...args) => mockChatRetentionDays(...args),
  },
}));
jest.mock("../../models/workspaceChats", () => ({
  WorkspaceChats: {
    delete: (...args) => mockWorkspaceDelete(...args),
  },
}));
jest.mock("../../models/embedChats", () => ({
  EmbedChats: {
    delete: (...args) => mockEmbedDelete(...args),
  },
}));

const {
  cleanupExpiredChats,
} = require("../../jobs/cleanup-expired-chats");

describe("cleanupExpiredChats", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("retention 0 = keep — does not delete chats", async () => {
    mockChatRetentionDays.mockResolvedValue(0);

    const result = await cleanupExpiredChats();

    expect(result).toEqual({ skipped: true, days: 0, cutoff: null });
    expect(mockWorkspaceDelete).not.toHaveBeenCalled();
    expect(mockEmbedDelete).not.toHaveBeenCalled();
  });

  test("default-like retention deletes workspace and embed chats older than the cutoff", async () => {
    mockChatRetentionDays.mockResolvedValue(90);
    const before = Date.now();

    const result = await cleanupExpiredChats();

    expect(result.skipped).toBe(false);
    expect(result.days).toBe(90);
    expect(result.cutoff).toBeInstanceOf(Date);

    const expectedMs = 90 * 24 * 60 * 60 * 1000;
    expect(result.cutoff.getTime()).toBeGreaterThanOrEqual(before - expectedMs - 50);
    expect(result.cutoff.getTime()).toBeLessThanOrEqual(Date.now() - expectedMs + 50);

    expect(mockWorkspaceDelete).toHaveBeenCalledWith({
      createdAt: { lt: result.cutoff },
    });
    expect(mockEmbedDelete).toHaveBeenCalledWith({
      createdAt: { lt: result.cutoff },
    });
  });
});
