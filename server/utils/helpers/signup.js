const { User } = require("../../models/user");
const { Organization } = require("../../models/organization");
const { Workspace } = require("../../models/workspace");
const { SystemSettings } = require("../../models/systemSettings");
const {
  emailIsValid,
  normalizeEmail,
  sessionUserPayload,
} = require("../tenant");
const { sessionTokenForUser } = require("../http");

const signupAttempts = new Map();
const SIGNUP_WINDOW_MS = 15 * 60 * 1000;
const SIGNUP_MAX_ATTEMPTS = 8;

function signupRateLimited(key) {
  const now = Date.now();
  const recent = (signupAttempts.get(key) || []).filter(
    (ts) => now - ts < SIGNUP_WINDOW_MS
  );
  recent.push(now);
  signupAttempts.set(key, recent);
  return recent.length > SIGNUP_MAX_ATTEMPTS;
}

function isSignupEnabled() {
  if (process.env.DISABLE_PUBLIC_SIGNUP === "true") return false;
  return true;
}

/**
 * Create a new isolated organization + admin user + default workspace.
 * Enables instance multi-user mode (hosted path is always multi-user).
 */
async function signupTenant({
  email,
  password,
  firstName,
  lastName,
  companyName,
  username = null,
}) {
  if (!isSignupEnabled()) {
    return {
      user: null,
      organization: null,
      token: null,
      error: "Signup is disabled.",
    };
  }

  const normalizedEmail = normalizeEmail(email);
  if (!emailIsValid(normalizedEmail)) {
    return {
      user: null,
      organization: null,
      token: null,
      error: "A valid email is required.",
    };
  }
  if (!String(firstName || "").trim() || !String(lastName || "").trim()) {
    return {
      user: null,
      organization: null,
      token: null,
      error: "First name and last name are required.",
    };
  }
  if (!String(companyName || "").trim()) {
    return {
      user: null,
      organization: null,
      token: null,
      error: "Company name is required.",
    };
  }

  const existingEmail = await User._get({ email: normalizedEmail });
  if (existingEmail) {
    return {
      user: null,
      organization: null,
      token: null,
      error: "A user with that email already exists",
    };
  }

  const resolvedUsername =
    username || (await User.uniqueUsernameFromEmail(normalizedEmail));

  const { organization, error: orgError } = await Organization.create({
    name: String(companyName).trim().slice(0, 255),
  });
  if (!organization) {
    return { user: null, organization: null, token: null, error: orgError };
  }

  const { user, error: userError } = await User.create({
    username: resolvedUsername,
    password,
    role: "admin",
    firstName,
    lastName,
    email: normalizedEmail,
  });
  if (!user) {
    return { user: null, organization: null, token: null, error: userError };
  }

  await Organization.addMember({
    organizationId: organization.id,
    userId: user.id,
    role: "admin",
  });

  await Workspace.new(String(companyName).trim().slice(0, 255), user.id, {
    organizationId: organization.id,
  });

  await SystemSettings._updateSettings({ multi_user_mode: true });

  const token = sessionTokenForUser(user, organization);
  return {
    user: sessionUserPayload(user, { role: "admin" }, organization),
    organization,
    token,
    error: null,
  };
}

module.exports = {
  signupTenant,
  signupRateLimited,
  isSignupEnabled,
};
