const { ConnectedFileSource } = require("../../models/connectedFileSource");
const { getFileSourceOAuthConfig } = require("./credentials");
const {
  AUTH_URL,
  graph,
  mapItem,
  refreshIfNeeded,
  listDriveChildren,
  downloadDriveItem,
  deltaDriveItem,
  getDeltaLinkForDrive,
} = require("./onedrive");
const {
  encodeTeam,
  encodeChannel,
  encodeDriveItem,
  parseLocator,
} = require("./graphLocators");
const {
  TEAMS_CONSENT_MESSAGE,
  SITES_CONSENT_MESSAGE,
  throwIfMissingScope,
  rethrowConsent,
} = require("./microsoftConsent");

// Channel files via Graph (joined teams). Teams bot install is PR 8.
const PROVIDER = "teams-files";
const SCOPES = [
  "offline_access",
  "User.Read",
  "Files.Read.All",
  "Sites.Read.All",
  "Team.ReadBasic.All",
  "Channel.ReadBasic.All",
].join(" ");

function withDriveIds(items, driveId) {
  return items.map((item) => {
    const itemId = item.itemId || item.id;
    return {
      ...item,
      id: encodeDriveItem(driveId, itemId),
      driveId,
      itemId,
    };
  });
}

function mapTeam(team) {
  return {
    id: encodeTeam(team.id),
    name: team.displayName || team.name,
    type: "folder",
    size: 0,
    modifiedAt: null,
    mimeType: null,
    webUrl: team.webUrl || null,
    indexable: true,
    teamId: team.id,
  };
}

function mapChannel(teamId, channel) {
  return {
    id: encodeChannel(teamId, channel.id),
    name: channel.displayName || channel.name,
    type: "folder",
    size: 0,
    modifiedAt: null,
    mimeType: null,
    webUrl: channel.webUrl || null,
    indexable: true,
    teamId,
    channelId: channel.id,
  };
}

function mapDelta(driveId) {
  return (item) => {
    const dId = driveId || item.parentReference?.driveId || null;
    if (item.deleted || item["@removed"]) {
      return {
        id: encodeDriveItem(dId, item.id),
        name: item.name,
        deleted: true,
        driveId: dId,
        itemId: item.id,
      };
    }
    return {
      ...mapItem(item),
      id: encodeDriveItem(dId, item.id),
      driveId: dId,
      itemId: item.id,
    };
  };
}

async function graphWithTeamsConsent(token, path, opts) {
  throwIfMissingScope(token, "Team.ReadBasic.All", TEAMS_CONSENT_MESSAGE);
  try {
    return await graph(token, path, opts);
  } catch (e) {
    rethrowConsent(e, TEAMS_CONSENT_MESSAGE);
  }
}

async function filesFolder(record, teamId, channelId) {
  const token = await refreshIfNeeded(record);
  const folder = await graphWithTeamsConsent(
    token,
    `/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/filesFolder`
  );
  const driveId = folder.parentReference?.driveId || null;
  const itemId = folder.id;
  if (!driveId || !itemId)
    throw new Error("Could not resolve the channel files folder.");
  return {
    driveId,
    itemId,
    name: folder.name,
    teamId,
    channelId,
  };
}

const TeamsFilesSource = {
  async authUrl(redirectUri, state) {
    const config = await getFileSourceOAuthConfig();
    if (!config.onedrive.clientId || !config.onedrive.clientSecret)
      return {
        success: false,
        error:
          "Teams files use the same Azure app as OneDrive. Add a Microsoft app client ID and secret in Settings → Cloud drives.",
      };
    const params = new URLSearchParams({
      client_id: config.onedrive.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      response_mode: "query",
      scope: SCOPES,
      state,
      prompt: "consent",
    });
    return {
      success: true,
      url: `${AUTH_URL}/authorize?${params.toString()}`,
    };
  },

  async exchangeCode(code, redirectUri) {
    const config = await getFileSourceOAuthConfig();
    const params = new URLSearchParams({
      client_id: config.onedrive.clientId,
      client_secret: config.onedrive.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      scope: SCOPES,
    });
    const res = await fetch(`${AUTH_URL}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const data = await res.json();
    if (!res.ok)
      return {
        success: false,
        error:
          data.error_description ||
          data.error ||
          "Teams files token exchange failed",
      };

    const me = await graph(data.access_token, "/me");
    await ConnectedFileSource.upsertByProvider(PROVIDER, {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_expires_at: new Date(Date.now() + (data.expires_in - 60) * 1000),
      account_email: me.mail || me.userPrincipalName || null,
      account_name: me.displayName || null,
    });
    return { success: true };
  },

  async listChildren(record, parentId = "root") {
    const token = await refreshIfNeeded(record);
    const loc = parseLocator(parentId);
    try {
      if (loc.kind === "root") {
        const data = await graphWithTeamsConsent(
          token,
          "/me/joinedTeams?$select=id,displayName,description,webUrl"
        );
        return {
          items: (data.value || []).map(mapTeam),
          next: data["@odata.nextLink"] || null,
        };
      }
      if (loc.kind === "team") {
        const data = await graphWithTeamsConsent(
          token,
          `/teams/${encodeURIComponent(loc.teamId)}/channels?$select=id,displayName,membershipType,webUrl`
        );
        return {
          items: (data.value || []).map((channel) =>
            mapChannel(loc.teamId, channel)
          ),
          next: data["@odata.nextLink"] || null,
        };
      }
      if (loc.kind === "channel") {
        const folder = await filesFolder(record, loc.teamId, loc.channelId);
        const listed = await listDriveChildren(
          record,
          folder.driveId,
          folder.itemId
        );
        return {
          items: withDriveIds(listed.items, folder.driveId).map((item) => ({
            ...item,
            teamId: loc.teamId,
            channelId: loc.channelId,
          })),
          next: listed.next,
          driveId: folder.driveId,
          itemId: folder.itemId,
        };
      }
      const driveId = loc.driveId;
      if (!driveId) throw new Error("Teams file folder is missing a drive id.");
      const listed = await listDriveChildren(record, driveId, loc.itemId);
      return {
        items: withDriveIds(listed.items, driveId),
        next: listed.next,
      };
    } catch (e) {
      const message = String(e.message || "").includes("Sites.Read.All")
        ? SITES_CONSENT_MESSAGE
        : TEAMS_CONSENT_MESSAGE;
      rethrowConsent(e, message);
    }
  },

  async search(record, query) {
    const { items } = await this.listChildren(record, "root");
    const q = String(query || "").toLowerCase();
    return {
      items: items.filter((item) =>
        String(item.name || "")
          .toLowerCase()
          .includes(q)
      ),
    };
  },

  async download(record, fileId) {
    const loc = parseLocator(fileId);
    if (loc.kind === "root" || loc.kind === "team") {
      const listed = await this.listChildren(record, fileId);
      return {
        kind: "folder",
        name: loc.kind === "team" ? "Team" : "Teams",
        children: listed.items,
        teamId: loc.teamId || null,
      };
    }
    if (loc.kind === "channel") {
      const folder = await filesFolder(record, loc.teamId, loc.channelId);
      const listed = await listDriveChildren(
        record,
        folder.driveId,
        folder.itemId
      );
      return {
        kind: "folder",
        name: folder.name,
        children: withDriveIds(listed.items, folder.driveId).map((item) => ({
          ...item,
          teamId: loc.teamId,
          channelId: loc.channelId,
        })),
        driveId: folder.driveId,
        itemId: folder.itemId,
        teamId: loc.teamId,
        channelId: loc.channelId,
      };
    }

    try {
      const downloaded = await downloadDriveItem(
        record,
        loc.itemId,
        loc.driveId
      );
      if (downloaded.kind === "folder") {
        const driveId = loc.driveId || downloaded.driveId;
        return {
          ...downloaded,
          children: withDriveIds(downloaded.children || [], driveId),
          driveId,
          itemId: loc.itemId || downloaded.itemId,
        };
      }
      return {
        ...downloaded,
        driveId: loc.driveId || downloaded.driveId,
        itemId: loc.itemId || downloaded.itemId,
      };
    } catch (e) {
      rethrowConsent(e, TEAMS_CONSENT_MESSAGE);
    }
  },

  async delta(record, folderId = "root", cursor = null) {
    const loc = parseLocator(folderId);
    let driveId = loc.driveId;
    let itemId = loc.itemId || "root";
    let teamId = loc.teamId;
    let channelId = loc.channelId;
    if (loc.kind === "channel") {
      const folder = await filesFolder(record, loc.teamId, loc.channelId);
      driveId = folder.driveId;
      itemId = folder.itemId;
      teamId = folder.teamId;
      channelId = folder.channelId;
    }
    if (!driveId)
      throw new Error("Teams file delta requires a channel files folder.");
    try {
      const page = await deltaDriveItem(record, {
        driveId,
        itemId,
        cursor,
        map: mapDelta(driveId),
      });
      return {
        ...page,
        items: (page.items || []).map((item) => ({
          ...item,
          teamId,
          channelId,
        })),
      };
    } catch (e) {
      rethrowConsent(e, TEAMS_CONSENT_MESSAGE);
    }
  },

  async getDeltaLink(record, folder = {}) {
    let driveId = folder.driveId;
    let itemId = folder.itemId;
    const loc = parseLocator(
      typeof folder === "string" ? folder : folder.id || folder.remote_id
    );
    if ((!driveId || !itemId) && loc.kind === "channel") {
      const files = await filesFolder(record, loc.teamId, loc.channelId);
      driveId = files.driveId;
      itemId = files.itemId;
    } else {
      driveId = driveId || loc.driveId;
      itemId = itemId || loc.itemId || "root";
    }
    if (!driveId)
      throw new Error("Teams file delta requires a channel files folder.");
    try {
      return await getDeltaLinkForDrive(record, {
        driveId,
        itemId,
        map: mapDelta(driveId),
      });
    } catch (e) {
      rethrowConsent(e, TEAMS_CONSENT_MESSAGE);
    }
  },
};

module.exports = { TeamsFilesSource, SCOPES, TEAMS_CONSENT_MESSAGE };
