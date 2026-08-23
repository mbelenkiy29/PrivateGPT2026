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
  encodeSite,
  encodeDrive,
  encodeDriveItem,
  parseLocator,
  isBrowseOnlyLocator,
} = require("./graphLocators");
const {
  SITES_CONSENT_MESSAGE,
  throwIfMissingScope,
  rethrowConsent,
} = require("./microsoftConsent");

const PROVIDER = "sharepoint";
const SCOPES = [
  "offline_access",
  "User.Read",
  "Files.Read.All",
  "Sites.Read.All",
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

function mapSite(site) {
  return {
    id: encodeSite(site.id),
    name: site.displayName || site.name,
    type: "folder",
    size: 0,
    modifiedAt: null,
    mimeType: null,
    webUrl: site.webUrl || null,
    indexable: false,
    siteId: site.id,
  };
}

function mapDrive(drive, siteId = null) {
  return {
    id: encodeDrive(drive.id),
    name: drive.name,
    type: "folder",
    size: 0,
    modifiedAt: null,
    mimeType: null,
    webUrl: drive.webUrl || null,
    indexable: true,
    driveId: drive.id,
    itemId: "root",
    siteId,
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

function refuseBrowseOnly(fileId) {
  if (!isBrowseOnlyLocator(fileId)) return;
  const err = new Error(
    "Pick a document library to index. SharePoint sites cannot be watched."
  );
  err.status = 400;
  throw err;
}

async function graphWithSitesConsent(token, path, opts) {
  throwIfMissingScope(token, "Sites.Read.All", SITES_CONSENT_MESSAGE);
  throwIfMissingScope(token, "Files.Read.All", SITES_CONSENT_MESSAGE);
  try {
    return await graph(token, path, opts);
  } catch (e) {
    rethrowConsent(e, SITES_CONSENT_MESSAGE);
  }
}

const SharePointSource = {
  async authUrl(redirectUri, state) {
    const config = await getFileSourceOAuthConfig();
    if (!config.onedrive.clientId || !config.onedrive.clientSecret)
      return {
        success: false,
        error:
          "SharePoint uses the same Azure app as OneDrive. Add a Microsoft app client ID and secret in Settings → Cloud drives.",
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
          "SharePoint token exchange failed",
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
        const data = await graphWithSitesConsent(
          token,
          "/sites?search=*&$select=id,displayName,name,webUrl&$top=50"
        );
        return {
          items: (data.value || []).map(mapSite),
          next: data["@odata.nextLink"] || null,
        };
      }
      if (loc.kind === "site") {
        const data = await graphWithSitesConsent(
          token,
          `/sites/${encodeURIComponent(loc.siteId)}/drives?$select=id,name,driveType,webUrl`
        );
        return {
          items: (data.value || []).map((drive) => mapDrive(drive, loc.siteId)),
          next: data["@odata.nextLink"] || null,
        };
      }
      const driveId = loc.driveId;
      if (!driveId) throw new Error("SharePoint folder is missing a drive id.");
      const listed = await listDriveChildren(record, driveId, loc.itemId);
      return {
        items: withDriveIds(listed.items, driveId),
        next: listed.next,
      };
    } catch (e) {
      rethrowConsent(e, SITES_CONSENT_MESSAGE);
    }
  },

  async search(record, query) {
    const token = await refreshIfNeeded(record);
    const q = encodeURIComponent(query);
    try {
      const data = await graphWithSitesConsent(
        token,
        `/sites?search=${q}&$select=id,displayName,name,webUrl&$top=50`
      );
      return { items: (data.value || []).map(mapSite) };
    } catch (e) {
      rethrowConsent(e, SITES_CONSENT_MESSAGE);
    }
  },

  async download(record, fileId) {
    refuseBrowseOnly(fileId);
    const loc = parseLocator(fileId);
    if (loc.kind === "drive") {
      const listed = await this.listChildren(record, fileId);
      let name = "Documents";
      const token = await refreshIfNeeded(record);
      try {
        const drive = await graphWithSitesConsent(
          token,
          `/drives/${encodeURIComponent(loc.driveId)}?$select=id,name`
        );
        name = drive.name || name;
      } catch (e) {
        rethrowConsent(e, SITES_CONSENT_MESSAGE);
      }
      return {
        kind: "folder",
        name,
        children: listed.items,
        driveId: loc.driveId || null,
        itemId: loc.itemId || "root",
        siteId: loc.siteId || null,
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
      rethrowConsent(e, SITES_CONSENT_MESSAGE);
    }
  },

  async delta(record, folderId = "root", cursor = null) {
    const loc = parseLocator(folderId);
    const driveId = loc.driveId;
    if (!driveId)
      throw new Error("SharePoint delta requires a document library.");
    try {
      return await deltaDriveItem(record, {
        driveId,
        itemId: loc.itemId || "root",
        cursor,
        map: mapDelta(driveId),
      });
    } catch (e) {
      rethrowConsent(e, SITES_CONSENT_MESSAGE);
    }
  },

  async getDeltaLink(record, folder = {}) {
    const loc = parseLocator(
      typeof folder === "string" ? folder : folder.id || folder.remote_id
    );
    const driveId = folder.driveId || loc.driveId;
    const itemId = folder.itemId || loc.itemId || "root";
    if (!driveId)
      throw new Error("SharePoint delta requires a document library.");
    try {
      return await getDeltaLinkForDrive(record, {
        driveId,
        itemId,
        map: mapDelta(driveId),
      });
    } catch (e) {
      rethrowConsent(e, SITES_CONSENT_MESSAGE);
    }
  },
};

module.exports = { SharePointSource, SCOPES, SITES_CONSENT_MESSAGE };
