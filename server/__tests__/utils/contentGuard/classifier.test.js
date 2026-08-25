const { classifyMessage, parseClassifierResponse } = require("../../../utils/contentGuard/classifier");

describe("contentGuard classifier", () => {
  it("parses a JSON allow/block payload", () => {
    expect(
      parseClassifierResponse('{"action":"block","category":"phishing"}')
    ).toEqual({ action: "block", category: "phishing" });
  });

  it("parses JSON wrapped in markdown fences", () => {
    expect(
      parseClassifierResponse(
        '```json\n{"action":"allow","category":"none"}\n```'
      )
    ).toEqual({ action: "allow", category: "none" });
  });

  it("rejects malformed or unknown actions", () => {
    expect(() => parseClassifierResponse("nope")).toThrow();
    expect(() =>
      parseClassifierResponse('{"action":"maybe","category":"none"}')
    ).toThrow();
  });

  it("blocks when the connector returns a block classification", async () => {
    const getConnector = () => ({
      getChatCompletion: jest.fn().mockResolvedValue({
        textResponse: '{"action":"block","category":"phishing"}',
      }),
    });
    const result = await classifyMessage("http://bit.ly/ab12cd", {
      getConnector,
      timeoutMs: 1000,
    });
    expect(result).toEqual({ action: "block", category: "phishing" });
  });

  it("times out and throws so inspect can fail open", async () => {
    const getConnector = () => ({
      getChatCompletion: () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                textResponse: '{"action":"block","category":"phishing"}',
              }),
            50
          )
        ),
    });
    await expect(
      classifyMessage("http://bit.ly/ab12cd", {
        getConnector,
        timeoutMs: 10,
      })
    ).rejects.toThrow(/timed out/i);
  });

  it("throws when no connector is available", async () => {
    await expect(
      classifyMessage("http://bit.ly/ab12cd", {
        getConnector: () => null,
      })
    ).rejects.toThrow();
  });
});
