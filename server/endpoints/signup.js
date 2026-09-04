const { reqBody } = require("../utils/http");
const {
  signupTenant,
  signupRateLimited,
  isSignupEnabled,
} = require("../utils/helpers/signup");

function signupEndpoints(app) {
  if (!app) return;

  app.get("/signup/enabled", (_request, response) => {
    response.status(200).json({ enabled: isSignupEnabled() });
  });

  app.post("/signup", async (request, response) => {
    try {
      if (!isSignupEnabled()) {
        response.status(403).json({
          user: null,
          valid: false,
          token: null,
          message: "Signup is disabled.",
        });
        return;
      }

      const ip = request.ip || request.headers["x-forwarded-for"] || "unknown";
      if (signupRateLimited(String(ip))) {
        response.status(429).json({
          user: null,
          valid: false,
          token: null,
          message: "Too many signup attempts. Try again later.",
        });
        return;
      }

      const { email, password, firstName, lastName, companyName, username } =
        reqBody(request) || {};
      const { user, token, error } = await signupTenant({
        email,
        password,
        firstName,
        lastName,
        companyName,
        username,
      });

      if (error || !user || !token) {
        response.status(200).json({
          user: null,
          valid: false,
          token: null,
          message: error || "Signup failed.",
        });
        return;
      }

      response.status(200).json({
        valid: true,
        user,
        token,
        message: null,
      });
    } catch (error) {
      console.error("signup", error);
      response.sendStatus(500).end();
    }
  });
}

module.exports = { signupEndpoints };
