const {
  sanitizeAudit,
  logBlock,
  logClassifierError,
} = require("../../../utils/contentGuard/audit");

describe("contentGuard audit", () => {
  it("strips raw message fields from metadata", () => {
    const clean = sanitizeAudit({
      category: "sexual",
      source: "rules",
      surface: "workspace_chat",
      workspaceSlug: "acme",
      incognito: true,
      urlCount: 0,
      message: "should not leak",
      prompt: "should not leak",
      content: "should not leak",
      text: "should not leak",
    });
    expect(clean).toEqual({
      category: "sexual",
      source: "rules",
      surface: "workspace_chat",
      workspaceSlug: "acme",
      incognito: true,
      urlCount: 0,
    });
    expect(JSON.stringify(clean)).not.toMatch(/should not leak/);
  });

  it("logs a block event without a message body", async () => {
    const logEvent = jest.fn().mockResolvedValue({});
    await logBlock(
      {
        category: "malware",
        source: "rules",
        surface: "workspace_chat",
        workspaceSlug: "acme",
        incognito: true,
        urlCount: 1,
        prompt: "https://evil.example/payload.exe",
      },
      42,
      logEvent
    );
    expect(logEvent).toHaveBeenCalledWith(
      "content_guard_block",
      expect.objectContaining({
        category: "malware",
        incognito: true,
        workspaceSlug: "acme",
      }),
      42
    );
    const metadata = logEvent.mock.calls[0][1];
    expect(metadata).not.toHaveProperty("prompt");
    expect(metadata).not.toHaveProperty("message");
    expect(JSON.stringify(metadata)).not.toMatch(/evil\.example/);
  });

  it("logs classifier errors without a message body", async () => {
    const logEvent = jest.fn().mockResolvedValue({});
    await logClassifierError(
      { surface: "workspace_chat", incognito: false, error: "timeout" },
      7,
      logEvent
    );
    expect(logEvent).toHaveBeenCalledWith(
      "content_guard_classifier_error",
      expect.objectContaining({ surface: "workspace_chat" }),
      7
    );
    expect(logEvent.mock.calls[0][1]).not.toHaveProperty("error");
  });
});
