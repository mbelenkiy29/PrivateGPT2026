import { ChatTeardropText } from "@phosphor-icons/react";
import * as Sentry from "@sentry/react";
import { openSentryFeedback as openSentryFeedbackForm } from "@/utils/sentryFeedback";

export function openSentryFeedback() {
  return openSentryFeedbackForm(() => Sentry.getFeedback?.());
}

export default function FeedbackButton() {
  if (!import.meta.env.VITE_SENTRY_DSN) return null;

  return (
    <div className="flex w-fit">
      <button
        type="button"
        onClick={openSentryFeedback}
        className="transition-all duration-300 p-2 rounded-full bg-theme-sidebar-footer-icon hover:bg-theme-sidebar-footer-icon-hover"
        aria-label="Send feedback"
        data-tooltip-id="footer-item"
        data-tooltip-content="Send feedback"
      >
        <ChatTeardropText
          className="h-5 w-5 text-white light:text-slate-800"
          weight="fill"
        />
      </button>
    </div>
  );
}
