const Sentry = require("@sentry/node");

const SENSITIVE_KEY =
  /^(message|prompt|content|text|token|password|authorization|cookie|document|chat|query)$/i;

function scrubEvent(event) {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    if (event.request.headers) {
      delete event.request.headers.Authorization;
      delete event.request.headers.authorization;
      delete event.request.headers.cookie;
      delete event.request.headers.Cookie;
    }
  }
  if (event.extra) {
    for (const key of Object.keys(event.extra)) {
      if (SENSITIVE_KEY.test(key)) delete event.extra[key];
    }
  }
  return event;
}

const dsn = process.env.SENTRY_DSN;
const isTest = process.env.NODE_ENV === "test";

if (dsn && !isTest) {
  Sentry.init({
    dsn,
    environment:
      process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
    release: process.env.SENTRY_RELEASE || process.env.DEPLOYMENT_VERSION,
    serverName: process.env.SENTRY_SERVICE || "server",
    sendDefaultPii: false,
    includeLocalVariables: false,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpBodies: [],
      genAI: { inputs: false, outputs: false },
    },
    tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
    initialScope: {
      tags: { service: process.env.SENTRY_SERVICE || "server" },
    },
    enabled: true,
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
    integrations: (integrations) =>
      integrations.map((integration) =>
        integration.name === "OnUncaughtException"
          ? Sentry.onUncaughtExceptionIntegration({
              exitEvenIfOtherHandlersAreRegistered: false,
            })
          : integration
      ),
  });
}

async function closeSentry() {
  try {
    await Sentry.close(2000);
  } catch {
    // ignore flush errors on shutdown
  }
}

module.exports = { Sentry, closeSentry };
