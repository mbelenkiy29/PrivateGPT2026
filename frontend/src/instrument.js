import * as Sentry from "@sentry/react";
import { useEffect } from "react";
import {
  createRoutesFromChildren,
  matchRoutes,
  useLocation,
  useNavigationType,
} from "react-router-dom";

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

const dsn = import.meta.env.VITE_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE || "development",
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
    sendDefaultPii: false,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpBodies: [],
      genAI: { inputs: false, outputs: false },
    },
    integrations: [
      Sentry.reactRouterV6BrowserTracingIntegration({
        useEffect,
        useLocation,
        useNavigationType,
        createRoutesFromChildren,
        matchRoutes,
      }),
    ],
    tracesSampleRate: import.meta.env.DEV ? 1.0 : 0.1,
    tracePropagationTargets: ["localhost", /^https?:\/\/localhost(:\d+)?/],
    initialScope: { tags: { service: "web" } },
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
  });
}

export default Sentry;
