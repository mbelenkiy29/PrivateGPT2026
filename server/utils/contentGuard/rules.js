const CATEGORY = {
  NONE: "none",
  SEXUAL: "sexual",
  MALWARE: "malware",
  PHISHING: "phishing",
  OTHER_HARM: "other_harm",
};

const VERDICT = {
  ALLOW: "allow",
  AMBIGUOUS: "ambiguous",
  BLOCK: "block",
};

/** Explicit sexual phrasing. Conservative — short words like "sex" are not listed. */
const SEXUAL_BLOCK_PHRASES = [
  "child pornography",
  "child porn",
  "child sexual",
  "csam",
  "pornography",
  "pornographic",
  "pornhub",
  "porn hub",
  "xxx video",
  "xxx videos",
  "bestiality",
  "zoophilia",
];

const MALWARE_EXTENSIONS = [
  ".exe",
  ".bat",
  ".cmd",
  ".scr",
  ".msi",
  ".apk",
  ".vbs",
  ".ps1",
];

const SHORTENER_HOSTS = new Set([
  "bit.ly",
  "t.co",
  "tinyurl.com",
  "goo.gl",
  "ow.ly",
  "is.gd",
  "cutt.ly",
  "rb.gy",
  "rebrand.ly",
  "shorturl.at",
]);

const PHISHING_PHRASES = [
  "verify your account",
  "confirm your password",
  "connect your wallet",
  "seed phrase",
  "wallet recovery",
];

const URL_RE = /(?:javascript:|data:|(?:https?:\/\/|www\.)[^\s<>"'`]+)/gi;

const IPV4_HOST_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function normalize(text = "") {
  return String(text).toLowerCase().replace(/\s+/g, " ").trim();
}

function extractUrls(text = "") {
  const matches = String(text).match(URL_RE) || [];
  return matches.map((raw) => raw.replace(/[),.;!?]+$/g, ""));
}

function parseHttpUrl(raw) {
  try {
    const withScheme = raw.startsWith("www.") ? `https://${raw}` : raw;
    return new URL(withScheme);
  } catch {
    return null;
  }
}

function pathLooksLikeMalware(pathname = "") {
  const path = pathname.toLowerCase();
  return MALWARE_EXTENSIONS.some(
    (ext) => path.endsWith(ext) || path.includes(`${ext}?`)
  );
}

function hostLooksLikeIp(hostname = "") {
  return IPV4_HOST_RE.test(hostname);
}

function hasCredentials(url) {
  return Boolean(url.username || url.password);
}

function isPunycode(hostname = "") {
  return hostname.toLowerCase().includes("xn--");
}

function isShortener(hostname = "") {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return SHORTENER_HOSTS.has(host);
}

function containsPhrase(haystack, phrase) {
  if (phrase.length <= 4) {
    const re = new RegExp(
      `\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "i"
    );
    return re.test(haystack);
  }
  return haystack.includes(phrase);
}

function evaluateRules(text = "") {
  const normalized = normalize(text);
  const urls = extractUrls(text);
  let verdict = VERDICT.ALLOW;
  let category = CATEGORY.NONE;

  const raise = (nextVerdict, nextCategory) => {
    const rank = { allow: 0, ambiguous: 1, block: 2 };
    if (rank[nextVerdict] > rank[verdict]) {
      verdict = nextVerdict;
      category = nextCategory;
    }
  };

  for (const phrase of SEXUAL_BLOCK_PHRASES) {
    if (containsPhrase(normalized, phrase)) {
      raise(VERDICT.BLOCK, CATEGORY.SEXUAL);
      break;
    }
  }

  for (const raw of urls) {
    const lower = raw.toLowerCase();
    if (lower.startsWith("javascript:") || lower.startsWith("data:")) {
      raise(VERDICT.BLOCK, CATEGORY.MALWARE);
      continue;
    }

    const parsed = parseHttpUrl(raw);
    if (!parsed) continue;

    if (
      pathLooksLikeMalware(parsed.pathname) ||
      hostLooksLikeIp(parsed.hostname) ||
      hasCredentials(parsed) ||
      isPunycode(parsed.hostname)
    ) {
      raise(VERDICT.BLOCK, CATEGORY.MALWARE);
      continue;
    }

    if (isShortener(parsed.hostname)) {
      raise(VERDICT.AMBIGUOUS, CATEGORY.PHISHING);
    }
  }

  if (urls.length > 0) {
    for (const phrase of PHISHING_PHRASES) {
      if (normalized.includes(phrase)) {
        raise(VERDICT.AMBIGUOUS, CATEGORY.PHISHING);
        break;
      }
    }
  }

  return {
    verdict,
    category,
    urlCount: urls.length,
  };
}

module.exports = {
  evaluateRules,
  extractUrls,
  CATEGORY,
  VERDICT,
};
