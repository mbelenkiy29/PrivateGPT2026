const { SystemSettings } = require("../../models/systemSettings");
const { safeJsonParse } = require("../http");

const CONFIG_LABEL = "file_source_oauth_config";

function envFallback() {
  return {
    onedrive: {
      clientId:
        process.env.MICROSOFT_FILES_CLIENT_ID ||
        process.env.ONEDRIVE_CLIENT_ID ||
        "",
      clientSecret:
        process.env.MICROSOFT_FILES_CLIENT_SECRET ||
        process.env.ONEDRIVE_CLIENT_SECRET ||
        "",
    },
    google: {
      clientId:
        process.env.GOOGLE_DRIVE_CLIENT_ID ||
        process.env.GOOGLE_CLIENT_ID ||
        "",
      clientSecret:
        process.env.GOOGLE_DRIVE_CLIENT_SECRET ||
        process.env.GOOGLE_CLIENT_SECRET ||
        "",
    },
  };
}

async function getFileSourceOAuthConfig() {
  const stored = safeJsonParse(
    (await SystemSettings.get({ label: CONFIG_LABEL }))?.value,
    {}
  );
  const env = envFallback();
  return {
    onedrive: {
      clientId: stored?.onedrive?.clientId || env.onedrive.clientId || "",
      clientSecret:
        stored?.onedrive?.clientSecret || env.onedrive.clientSecret || "",
    },
    google: {
      clientId: stored?.google?.clientId || env.google.clientId || "",
      clientSecret:
        stored?.google?.clientSecret || env.google.clientSecret || "",
    },
  };
}

function maskSecret(secret) {
  if (!secret) return "";
  if (secret.length <= 4) return "****";
  return `${"*".repeat(Math.max(secret.length - 4, 4))}${secret.slice(-4)}`;
}

function publicConfig(config) {
  return {
    onedrive: {
      clientId: config.onedrive.clientId || "",
      clientSecret: maskSecret(config.onedrive.clientSecret),
      configured: Boolean(
        config.onedrive.clientId && config.onedrive.clientSecret
      ),
    },
    google: {
      clientId: config.google.clientId || "",
      clientSecret: maskSecret(config.google.clientSecret),
      configured: Boolean(config.google.clientId && config.google.clientSecret),
    },
  };
}

function looksMasked(value) {
  return typeof value === "string" && /^\*+.+$/.test(value);
}

module.exports = {
  CONFIG_LABEL,
  getFileSourceOAuthConfig,
  publicConfig,
  looksMasked,
};
