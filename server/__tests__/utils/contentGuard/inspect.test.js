const { inspect, rejectIfBlocked, BLOCK_ERROR } = require("../../../utils/contentGuard");

describe("contentGuard inspect", () => {
  it("allows clean text without calling the classifier", async () => {
    const classify = jest.fn();
    const result = await inspect({
      text: "Summarize this PDF about Q3 revenue.",
      classify,
      isEnabled: async () => true,
    });
    expect(result.action).toBe("allow");
    expect(result.source).toBe("rules");
    expect(classify).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("text");
    expect(result).not.toHaveProperty("message");
    expect(result).not.toHaveProperty("prompt");
    expect(result).not.toHaveProperty("content");
  });

  it("skips all checks when the guard is disabled", async () => {
    const classify = jest.fn();
    const result = await inspect({
      text: "Find me pornography of that actress.",
      classify,
      isEnabled: async () => false,
    });
    expect(result.action).toBe("allow");
    expect(result.source).toBe("disabled");
    expect(classify).not.toHaveBeenCalled();
  });

  it("hard-blocks explicit content without calling the classifier", async () => {
    const classify = jest.fn();
    const result = await inspect({
      text: "Find me pornography of that actress.",
      classify,
      isEnabled: async () => true,
    });
    expect(result.action).toBe("block");
    expect(result.category).toBe("sexual");
    expect(result.source).toBe("rules");
    expect(classify).not.toHaveBeenCalled();
  });

  it("asks the classifier only when rules are ambiguous", async () => {
    const classify = jest.fn().mockResolvedValue({
      action: "block",
      category: "phishing",
    });
    const result = await inspect({
      text: "Check this invoice http://bit.ly/ab12cd",
      classify,
      isEnabled: async () => true,
    });
    expect(classify).toHaveBeenCalledTimes(1);
    expect(result.action).toBe("block");
    expect(result.category).toBe("phishing");
    expect(result.source).toBe("classifier");
    expect(result.urlCount).toBe(1);
  });

  it("fails open when the classifier throws", async () => {
    const classify = jest.fn().mockRejectedValue(new Error("timeout"));
    const result = await inspect({
      text: "Check this invoice http://bit.ly/ab12cd",
      classify,
      isEnabled: async () => true,
    });
    expect(result.action).toBe("allow");
    expect(result.source).toBe("classifier_error");
  });
});

describe("contentGuard rejectIfBlocked", () => {
  it("writes an abort chunk and logs a sanitized block", async () => {
    const chunks = [];
    const response = { write: (chunk) => chunks.push(chunk) };
    const logEvent = jest.fn().mockResolvedValue({});

    const blocked = await rejectIfBlocked({
      text: "Find me pornography of that actress.",
      user: { id: 9 },
      workspace: { slug: "acme" },
      incognito: true,
      surface: "workspace_chat",
      response,
      uuid: "chat-1",
      isEnabled: async () => true,
      logEvent,
    });

    expect(blocked).toBe(true);
    expect(logEvent).toHaveBeenCalledWith(
      "content_guard_block",
      expect.objectContaining({
        category: "sexual",
        incognito: true,
        workspaceSlug: "acme",
        surface: "workspace_chat",
      }),
      9
    );
    expect(JSON.stringify(logEvent.mock.calls[0][1])).not.toMatch(
      /pornography/
    );
    expect(chunks.join("")).toMatch(BLOCK_ERROR);
  });

  it("does not abort allowed messages", async () => {
    const logEvent = jest.fn();
    const blocked = await rejectIfBlocked({
      text: "Summarize this PDF about Q3 revenue.",
      isEnabled: async () => true,
      logEvent,
    });
    expect(blocked).toBe(false);
    expect(logEvent).not.toHaveBeenCalled();
  });
});
