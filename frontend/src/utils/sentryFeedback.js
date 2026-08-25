export const FEEDBACK_INTEGRATION_OPTIONS = {
  autoInject: false,
  enableScreenshot: false,
  showBranding: false,
  colorScheme: "system",
  showName: true,
  showEmail: true,
  isNameRequired: false,
  isEmailRequired: false,
  useSentryUser: { name: "username" },
  triggerLabel: "Send feedback",
  triggerAriaLabel: "Send feedback",
  formTitle: "Send feedback",
  submitButtonLabel: "Send feedback",
  messageLabel: "Description",
  messagePlaceholder: "What went wrong or what can we improve?",
  successMessageText: "Thanks — your feedback was sent.",
  tags: { service: "web", source: "sidebar-feedback" },
  themeLight: {
    accentBackground: "#0ea5e9",
    accentForeground: "#ffffff",
  },
  themeDark: {
    accentBackground: "#0ea5e9",
    accentForeground: "#ffffff",
  },
};

let feedbackFormPromise;

export function resetSentryFeedbackForm() {
  feedbackFormPromise = undefined;
}

export async function openSentryFeedback(getFeedback) {
  const feedback = getFeedback?.();
  if (!feedback?.createForm) return false;
  if (!feedbackFormPromise) {
    feedbackFormPromise = feedback.createForm().then((form) => {
      form.appendToDom();
      return form;
    });
  }
  const form = await feedbackFormPromise;
  form.open();
  return true;
}
