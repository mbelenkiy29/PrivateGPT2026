/* eslint-env jest */

const {
  parseRetentionDays,
  embedChatClauseForUser,
} = require("../../utils/helpers/trust");

describe("parseRetentionDays", () => {
  test("0 is keep-forever (accepted)", () => {
    expect(parseRetentionDays(0)).toEqual({ days: 0, error: null });
  });

  test("positive numbers are floored", () => {
    expect(parseRetentionDays(90)).toEqual({ days: 90, error: null });
    expect(parseRetentionDays(1.9)).toEqual({ days: 1, error: null });
  });

  test("rejects null and empty string instead of treating them as 0", () => {
    expect(parseRetentionDays(null).error).toBeTruthy();
    expect(parseRetentionDays("").error).toBeTruthy();
    expect(parseRetentionDays(null).days).toBeNull();
    expect(parseRetentionDays("").days).toBeNull();
  });

  test("rejects missing, string numbers, and negatives", () => {
    expect(parseRetentionDays(undefined).error).toBeTruthy();
    expect(parseRetentionDays("0").error).toBeTruthy();
    expect(parseRetentionDays(-1).error).toBeTruthy();
  });
});

describe("embedChatClauseForUser", () => {
  test("keys off embed_configs.createdBy, not only usersId", () => {
    expect(embedChatClauseForUser(7)).toEqual({
      OR: [{ usersId: 7 }, { embed_config: { createdBy: 7 } }],
    });
  });
});
