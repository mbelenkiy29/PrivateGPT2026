export function displayName(user) {
  if (!user) return "";
  const name = [user.firstName, user.lastName]
    .map((part) => (part || "").trim())
    .filter(Boolean)
    .join(" ");
  return name || user.username || "";
}

export function displayInitials(user) {
  const name = displayName(user);
  if (!name) return "AA";
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

export function needsUserOnboarding(user) {
  if (!user) return false;
  return user.onboardingComplete === false || user.onboardingComplete === 0;
}
