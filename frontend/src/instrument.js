import * as Sentry from "@sentry/react";
import { useEffect } from "react";
import {
  createRoutesFromChildren,
  matchRoutes,
  useLocation,
  useNavigationType,
} from "react-router-dom";
import { FEEDBACK_INTEGRATION_OPTIONS } from "@/utils/sentryFeedback";
import { scrubEvent } from "@/utils/sentryScrub";

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
      Sentry.feedbackIntegration(FEEDBACK_INTEGRATION_OPTIONS),
    ],
    tracesSampleRate: import.meta.env.DEV ? 1.0 : 0.1,
    tracePropagationTargets: ["localhost", /^https?:\/\/localhost(:\d+)?/],
    initialScope: { tags: { service: "web" } },
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
  });
}

export default Sentry;
