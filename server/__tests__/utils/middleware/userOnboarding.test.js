const {
  isAllowedWhileOnboarding,
  requireOnboardingComplete,
} = require("../../../utils/middleware/userOnboarding");

jest.mock("../../../models/systemSettings", () => ({
  SystemSettings: {
    isMultiUserMode: jest.fn(),
  },
}));
jest.mock("../../../utils/http", () => ({
  userFromSession: jest.fn(),
}));

const { SystemSettings } = require("../../../models/systemSettings");
const { userFromSession } = require("../../../utils/http");

function mockResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    locals: {},
  };
}

describe("onboarding API gate", () => {
  it("allows profile and invite routes while onboarding", () => {
    expect(isAllowedWhileOnboarding("GET", "/user/onboarding")).toBe(true);
    expect(isAllowedWhileOnboarding("POST", "/user/onboarding/complete")).toBe(
      true
    );
    expect(isAllowedWhileOnboarding("POST", "/system/user")).toBe(true);
    expect(isAllowedWhileOnboarding("POST", "/workspace/new")).toBe(true);
    expect(isAllowedWhileOnboarding("GET", "/workspaces")).toBe(true);
    expect(isAllowedWhileOnboarding("POST", "/invite/abc")).toBe(true);
    expect(isAllowedWhileOnboarding("POST", "/signup")).toBe(true);
    expect(isAllowedWhileOnboarding("GET", "/signup/enabled")).toBe(true);
  });

  it("blocks chat while onboarding", () => {
    expect(
      isAllowedWhileOnboarding("POST", "/workspace/acme/stream-chat")
    ).toBe(false);
  });

  it("returns 403 for incomplete users on blocked routes", async () => {
    SystemSettings.isMultiUserMode.mockResolvedValue(true);
    userFromSession.mockResolvedValue({
      id: 2,
      onboardingComplete: false,
      role: "default",
    });
    const next = jest.fn();
    const response = mockResponse();

    await requireOnboardingComplete(
      { method: "POST", path: "/workspace/acme/stream-chat" },
      response,
      next
    );

    expect(next).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({ onboardingRequired: true })
    );
  });

  it("allows incomplete users on the complete endpoint", async () => {
    SystemSettings.isMultiUserMode.mockResolvedValue(true);
    userFromSession.mockResolvedValue({
      id: 2,
      onboardingComplete: false,
      role: "default",
    });
    const next = jest.fn();
    const response = mockResponse();

    await requireOnboardingComplete(
      { method: "POST", path: "/user/onboarding/complete" },
      response,
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("does not block completed users", async () => {
    SystemSettings.isMultiUserMode.mockResolvedValue(true);
    userFromSession.mockResolvedValue({
      id: 1,
      onboardingComplete: true,
      role: "admin",
    });
    const next = jest.fn();
    const response = mockResponse();

    await requireOnboardingComplete(
      { method: "POST", path: "/workspace/acme/stream-chat" },
      response,
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
  });
});
