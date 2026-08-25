const {
  hasProfileNames,
  displayName,
  onboardingRequirements,
} = require("../../../utils/helpers/userOnboarding");

describe("user onboarding helpers", () => {
  it("requires both first and last name for a complete profile", () => {
    expect(hasProfileNames({ firstName: "Ada", lastName: "Lovelace" })).toBe(
      true
    );
    expect(hasProfileNames({ firstName: "Ada", lastName: "  " })).toBe(false);
    expect(hasProfileNames({ firstName: "", lastName: "Lovelace" })).toBe(
      false
    );
  });

  it("builds a display name from first and last, then username", () => {
    expect(displayName({ firstName: "Ada", lastName: "Lovelace" })).toBe(
      "Ada Lovelace"
    );
    expect(displayName({ username: "ada" })).toBe("ada");
  });

  it("lets employees complete with names only", () => {
    const { canComplete, workspace, invite } = onboardingRequirements({
      user: { role: "default", firstName: "Ada", lastName: "Lovelace" },
      workspaces: [],
      invites: [],
    });
    expect(workspace).toBe(true);
    expect(invite).toBe(true);
    expect(canComplete).toBe(true);
  });

  it("blocks admin complete until a workspace and invite exist", () => {
    const missing = onboardingRequirements({
      user: { role: "admin", firstName: "Ada", lastName: "Lovelace" },
      workspaces: [],
      invites: [],
    });
    expect(missing.canComplete).toBe(false);
    expect(missing.workspace).toBe(false);
    expect(missing.invite).toBe(false);

    const ready = onboardingRequirements({
      user: { role: "admin", firstName: "Ada", lastName: "Lovelace" },
      workspaces: [{ id: 1, name: "Acme" }],
      invites: [{ status: "pending" }],
    });
    expect(ready.canComplete).toBe(true);
  });
});
