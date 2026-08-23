const { SystemSettings } = require("../../models/systemSettings");
const { KnowledgeSource } = require("../../models/knowledgeSource");
const { safeJsonParse } = require("../http");

const NOTION_SETTING = "notion_integration";
const DROPBOX_SETTING = "dropbox_oauth_config";

function looksMasked(value) {
  return typeof value === "string" && /^\*+.+$/.test(value);
}

function maskSecret(secret) {
  if (!secret) return "";
  if (secret.length <= 4) return "****";
  return `${"*".repeat(Math.max(secret.length - 4, 4))}${secret.slice(-4)}`;
}

function envDropbox() {
  return {
    clientId: process.env.DROPBOX_CLIENT_ID || "",
    clientSecret: process.env.DROPBOX_CLIENT_SECRET || "",
  };
}

function envNotionToken() {
  return process.env.NOTION_INTEGRATION_TOKEN || "";
}

async function readSetting(label) {
  const row = await SystemSettings.get({ label });
  if (!row?.value) return null;
  const decrypted = KnowledgeSource.decrypt(row.value);
  if (!decrypted) return safeJsonParse(row.value, row.value);
  return safeJsonParse(decrypted, decrypted);
}

async function writeSetting(label, value) {
  const payload =
    typeof value === "string" ? value : JSON.stringify(value ?? {});
  const encrypted = KnowledgeSource.encrypt(payload);
  return SystemSettings._updateSettings({ [label]: encrypted });
}

async function getNotionToken() {
  const stored = await readSetting(NOTION_SETTING);
  if (typeof stored === "string" && stored) return stored;
  if (stored?.token) return stored.token;
  return envNotionToken() || "";
}

async function saveNotionToken(token) {
  const trimmed = String(token || "").trim();
  if (!trimmed) throw new Error("Notion integration token is required.");
  await writeSetting(NOTION_SETTING, { token: trimmed });
  return trimmed;
}

async function clearNotionToken() {
  await SystemSettings._updateSettings({ [NOTION_SETTING]: null });
}

async function getDropboxOAuthConfig() {
  const stored = (await readSetting(DROPBOX_SETTING)) || {};
  const env = envDropbox();
  return {
    clientId: stored.clientId || env.clientId || "",
    clientSecret: stored.clientSecret || env.clientSecret || "",
  };
}

async function saveDropboxOAuthConfig(incoming = {}) {
  const existing = await getDropboxOAuthConfig();
  const next = {
    clientId: incoming.clientId ?? existing.clientId,
    clientSecret: looksMasked(incoming.clientSecret)
      ? existing.clientSecret
      : incoming.clientSecret ?? existing.clientSecret,
  };
  await writeSetting(DROPBOX_SETTING, next);
  return next;
}

function publicDropboxConfig(config) {
  return {
    clientId: config.clientId || "",
    clientSecret: maskSecret(config.clientSecret),
    configured: Boolean(config.clientId && config.clientSecret),
  };
}

module.exports = {
  NOTION_SETTING,
  DROPBOX_SETTING,
  looksMasked,
  maskSecret,
  getNotionToken,
  saveNotionToken,
  clearNotionToken,
  getDropboxOAuthConfig,
  saveDropboxOAuthConfig,
  publicDropboxConfig,
};
