const SENSITIVE_KEY =
  /^(message|prompt|content|text|token|password|authorization|cookie|document|chat|query)$/i;

/**
 * Strip chat/auth payloads from Sentry events.
 * User Feedback lives on contexts.feedback.message — leave that intact.
 */
export function scrubEvent(event) {
  if (!event) return event;
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
