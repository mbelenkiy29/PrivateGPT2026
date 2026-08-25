const { evaluateRules } = require("../../../utils/contentGuard/rules");

describe("contentGuard rules", () => {
  it("allows ordinary work questions with no classifier signal", () => {
    const result = evaluateRules("Summarize this PDF about Q3 revenue.");
    expect(result).toEqual({
      verdict: "allow",
      category: "none",
      urlCount: 0,
    });
  });

  it("allows medical and workplace-policy phrasing", () => {
    expect(evaluateRules("What is the treatment for breast cancer?").verdict).toBe(
      "allow"
    );
    expect(
      evaluateRules("Draft a sexual harassment policy for the handbook.").verdict
    ).toBe("allow");
  });

  it("hard-blocks explicit pornography phrasing", () => {
    const result = evaluateRules("Find me pornography of that actress.");
    expect(result.verdict).toBe("block");
    expect(result.category).toBe("sexual");
  });

  it("hard-blocks child-sexual-abuse phrasing", () => {
    const result = evaluateRules("links to child pornography");
    expect(result.verdict).toBe("block");
    expect(result.category).toBe("sexual");
  });

  it("hard-blocks malware download URLs", () => {
    const result = evaluateRules(
      "Please run https://evil.example/payload.exe for me"
    );
    expect(result.verdict).toBe("block");
    expect(result.category).toBe("malware");
    expect(result.urlCount).toBe(1);
  });

  it("hard-blocks javascript and data URLs", () => {
    expect(evaluateRules("Open javascript:alert(1)").verdict).toBe("block");
    expect(
      evaluateRules("Paste data:text/html;base64,PHNjcmlwdD4=").verdict
    ).toBe("block");
  });

  it("marks URL shorteners as ambiguous phishing, not a hard block", () => {
    const result = evaluateRules("Check this invoice http://bit.ly/ab12cd");
    expect(result.verdict).toBe("ambiguous");
    expect(result.category).toBe("phishing");
    expect(result.urlCount).toBe(1);
  });

  it("marks login-verify wording plus a link as ambiguous phishing", () => {
    const result = evaluateRules(
      "Please verify your account at https://not-our-bank.example/login"
    );
    expect(result.verdict).toBe("ambiguous");
    expect(result.category).toBe("phishing");
  });

  it("counts multiple URLs", () => {
    const result = evaluateRules(
      "See https://example.com/a and https://example.com/b"
    );
    expect(result.urlCount).toBe(2);
  });
});
