/**
 * Composite ids so SharePoint/Teams items stay unique across drives.
 * site:{siteId}
 * drive:{driveId}
 * drive:{driveId}:item:{itemId}
 * team:{teamId}
 * team:{teamId}:channel:{channelId}
 */

function encodeSite(siteId) {
  return `site:${siteId}`;
}

function encodeDrive(driveId) {
  return `drive:${driveId}`;
}

function encodeDriveItem(driveId, itemId) {
  if (!driveId) return itemId;
  if (!itemId || itemId === "root") return encodeDrive(driveId);
  return `drive:${driveId}:item:${itemId}`;
}

function encodeTeam(teamId) {
  return `team:${teamId}`;
}

function encodeChannel(teamId, channelId) {
  return `team:${teamId}:channel:${channelId}`;
}

const BROWSE_ONLY_KINDS = new Set(["root", "site", "team"]);

function isBrowseOnlyLocator(id) {
  return BROWSE_ONLY_KINDS.has(parseLocator(id).kind);
}

function canWatchGraphFolder(folder = {}) {
  if (isBrowseOnlyLocator(folder.id || folder.remote_id)) return false;
  return Boolean(folder.driveId);
}

function parseLocator(id) {
  if (!id || id === "root") return { kind: "root" };
  const value = String(id);
  if (value.startsWith("site:"))
    return { kind: "site", siteId: value.slice(5) };
  if (value.startsWith("team:") && value.includes(":channel:")) {
    const at = value.indexOf(":channel:");
    return {
      kind: "channel",
      teamId: value.slice(5, at),
      channelId: value.slice(at + 9),
    };
  }
  if (value.startsWith("team:"))
    return { kind: "team", teamId: value.slice(5) };
  if (value.startsWith("drive:")) {
    const rest = value.slice(6);
    const sep = ":item:";
    const at = rest.indexOf(sep);
    if (at === -1) return { kind: "drive", driveId: rest, itemId: "root" };
    return {
      kind: "item",
      driveId: rest.slice(0, at),
      itemId: rest.slice(at + sep.length),
    };
  }
  return { kind: "item", itemId: value, driveId: null };
}

module.exports = {
  encodeSite,
  encodeDrive,
  encodeDriveItem,
  encodeTeam,
  encodeChannel,
  parseLocator,
  isBrowseOnlyLocator,
  canWatchGraphFolder,
};
