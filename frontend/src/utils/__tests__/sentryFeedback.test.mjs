import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
  FEEDBACK_INTEGRATION_OPTIONS,
  openSentryFeedback,
  resetSentryFeedbackForm,
} from "../sentryFeedback.js";
import { scrubEvent } from "../sentryScrub.js";

describe("FEEDBACK_INTEGRATION_OPTIONS", () => {
  it("does not auto-inject Sentry's floating widget", () => {
    assert.equal(FEEDBACK_INTEGRATION_OPTIONS.autoInject, false);
  });

  it("does not capture screenshots of the private chat UI", () => {
    assert.equal(FEEDBACK_INTEGRATION_OPTIONS.enableScreenshot, false);
  });

  it("does not require email (email is not stored on the Sentry user)", () => {
    assert.equal(FEEDBACK_INTEGRATION_OPTIONS.isEmailRequired, false);
    assert.deepEqual(FEEDBACK_INTEGRATION_OPTIONS.useSentryUser, {
      name: "username",
    });
  });
});

describe("openSentryFeedback", () => {
  beforeEach(() => {
    resetSentryFeedbackForm();
  });

  it("no-ops when the Feedback integration is missing", async () => {
    assert.equal(await openSentryFeedback(() => undefined), false);
    assert.equal(await openSentryFeedback(undefined), false);
  });

  it("creates the form once, mounts it, and opens the dialog", async () => {
    const form = {
      appendToDomCalls: 0,
      openCalls: 0,
      appendToDom() {
        this.appendToDomCalls += 1;
      },
      open() {
        this.openCalls += 1;
      },
    };
    let createFormCalls = 0;
    const getFeedback = () => ({
      createForm: async () => {
        createFormCalls += 1;
        return form;
      },
    });

    assert.equal(await openSentryFeedback(getFeedback), true);
    assert.equal(await openSentryFeedback(getFeedback), true);
    assert.equal(createFormCalls, 1);
    assert.equal(form.appendToDomCalls, 1);
    assert.equal(form.openCalls, 2);
  });
});

describe("scrubEvent", () => {
  it("strips request bodies, cookies, and auth headers", () => {
    const event = {
      request: {
        data: { prompt: "secret chat" },
        cookies: { session: "abc" },
        headers: {
          Authorization: "Bearer tok",
          authorization: "Bearer tok",
          cookie: "a=b",
          Cookie: "a=b",
          Accept: "application/json",
        },
      },
      extra: { message: "chat text", prompt: "hi", ok: "keep" },
    };
    const scrubbed = scrubEvent(event);
    assert.equal(scrubbed.request.data, undefined);
    assert.equal(scrubbed.request.cookies, undefined);
    assert.equal(scrubbed.request.headers.Authorization, undefined);
    assert.equal(scrubbed.request.headers.cookie, undefined);
    assert.equal(scrubbed.request.headers.Accept, "application/json");
    assert.equal(scrubbed.extra.message, undefined);
    assert.equal(scrubbed.extra.prompt, undefined);
    assert.equal(scrubbed.extra.ok, "keep");
  });

  it("does not strip User Feedback message context", () => {
    const event = {
      contexts: {
        feedback: {
          message: "The settings page is blank",
          name: "mike",
        },
      },
      extra: { message: "should be removed" },
    };
    const scrubbed = scrubEvent(event);
    assert.equal(
      scrubbed.contexts.feedback.message,
      "The settings page is blank"
    );
    assert.equal(scrubbed.extra.message, undefined);
  });
});
