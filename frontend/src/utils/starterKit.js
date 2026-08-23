import { STARTER_KIT_ONBOARDING, STARTER_KIT_PROMPT } from "@/utils/constants";
import { safeJsonParse } from "@/utils/request";

export function firstSuggestedQuestion(kit) {
  const first = kit?.suggestedMessages?.[0];
  if (!first) return "";
  return (first.message || first.heading || "").trim();
}

export function rememberStarterKitOnboarding({ slug, firstQuestion, kitId }) {
  sessionStorage.setItem(
    STARTER_KIT_ONBOARDING,
    JSON.stringify({ slug, firstQuestion, kitId })
  );
}

export function readStarterKitOnboarding() {
  return safeJsonParse(sessionStorage.getItem(STARTER_KIT_ONBOARDING), null);
}

export function consumeStarterKitOnboarding() {
  const data = readStarterKitOnboarding();
  sessionStorage.removeItem(STARTER_KIT_ONBOARDING);
  return data;
}

export function continueToKitChat(navigate, paths) {
  const landing = consumeStarterKitOnboarding();
  if (landing?.firstQuestion) queueStarterKitPrompt(landing.firstQuestion);
  if (landing?.slug) {
    navigate(paths.workspace.chat(landing.slug));
    return true;
  }
  return false;
}

export function queueStarterKitPrompt(text) {
  if (!text) return;
  sessionStorage.setItem(STARTER_KIT_PROMPT, text);
}

export function consumeStarterKitPrompt() {
  const text = sessionStorage.getItem(STARTER_KIT_PROMPT);
  if (text) sessionStorage.removeItem(STARTER_KIT_PROMPT);
  return text;
}
