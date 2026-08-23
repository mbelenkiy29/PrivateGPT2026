/* eslint-env jest */

jest.mock("../../../models/connectedFileSource", () => ({
  ConnectedFileSource: {
    tokens: jest.fn(),
    upsertByProvider: jest.fn(),
  },
}));

jest.mock("../../../utils/fileSources/credentials", () => ({
  getFileSourceOAuthConfig: jest.fn(),
}));

const { ConnectedFileSource } = require("../../../models/connectedFileSource");
const {
  getFileSourceOAuthConfig,
} = require("../../../utils/fileSources/credentials");
const { TeamsFilesSource } = require("../../../utils/fileSources/teamsFiles");
const {
  TEAMS_CONSENT_MESSAGE,
} = require("../../../utils/fileSources/microsoftConsent");

function jwtWithScopes(scp) {
  const payload = Buffer.from(JSON.stringify({ scp })).toString("base64url");
  return `hdr.${payload}.sig`;
}

function jsonOk(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    arrayBuffer: async () => Buffer.from("file-bytes"),
  };
}

function jsonErr(status, message) {
  return {
    ok: false,
    status,
    json: async () => ({ error: { message } }),
    arrayBuffer: async () => Buffer.from(""),
  };
}

describe("TeamsFilesSource", () => {
  const record = { id: 4, provider: "teams-files" };

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
    ConnectedFileSource.tokens.mockReturnValue({
      accessToken: jwtWithScopes(
        "Files.Read.All Sites.Read.All Team.ReadBasic.All Channel.ReadBasic.All User.Read"
      ),
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 60 * 60 * 1000,
    });
    getFileSourceOAuthConfig.mockResolvedValue({
      onedrive: { clientId: "cid", clientSecret: "secret" },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("builds an auth URL from the same Azure app with Teams Graph scopes", async () => {
    const result = await TeamsFilesSource.authUrl(
      "http://localhost:3002/api/file-sources/teams-files/callback",
      "state-1"
    );
    expect(result.success).toBe(true);
    const url = new URL(result.url);
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("scope")).toContain("Team.ReadBasic.All");
    expect(url.searchParams.get("scope")).toContain("Channel.ReadBasic.All");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("lists joined teams at root", async () => {
    global.fetch.mockResolvedValue(
      jsonOk({
        value: [{ id: "t1", displayName: "Engineering" }],
      })
    );
    const page = await TeamsFilesSource.listChildren(record, "root");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/me/joinedTeams"),
      expect.any(Object)
    );
    expect(page.items[0]).toEqual(
      expect.objectContaining({
        id: "team:t1",
        name: "Engineering",
        type: "folder",
      })
    );
  });

  it("lists channels then files in the channel filesFolder", async () => {
    global.fetch
      .mockResolvedValueOnce(
        jsonOk({
          value: [{ id: "c1", displayName: "General" }],
        })
      )
      .mockResolvedValueOnce(
        jsonOk({
          id: "folder-1",
          name: "General",
          parentReference: { driveId: "d1" },
        })
      )
      .mockResolvedValueOnce(
        jsonOk({
          value: [
            {
              id: "i1",
              name: "standup.md",
              file: { mimeType: "text/markdown" },
            },
          ],
        })
      );

    const channels = await TeamsFilesSource.listChildren(record, "team:t1");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/teams/t1/channels"),
      expect.any(Object)
    );
    expect(channels.items[0].id).toBe("team:t1:channel:c1");

    const files = await TeamsFilesSource.listChildren(
      record,
      "team:t1:channel:c1"
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/teams/t1/channels/c1/filesFolder"),
      expect.any(Object)
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/drives/d1/items/folder-1/children"),
      expect.any(Object)
    );
    expect(files.items[0]).toEqual(
      expect.objectContaining({
        id: "drive:d1:item:i1",
        name: "standup.md",
        teamId: "t1",
        channelId: "c1",
      })
    );
  });

  it("downloads a channel file via the shared OneDrive Graph content path", async () => {
    global.fetch
      .mockResolvedValueOnce(
        jsonOk({
          id: "i1",
          name: "standup.md",
          file: { mimeType: "text/markdown" },
        })
      )
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => Buffer.from("# standup"),
      });

    const file = await TeamsFilesSource.download(
      record,
      "drive:d1:item:i1"
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/drives/d1/items/i1/content"),
      expect.any(Object)
    );
    expect(file.kind).toBe("file");
    expect(file.name).toBe("standup.md");
  });

  it("fails with a re-consent message when Team.ReadBasic.All is missing", async () => {
    ConnectedFileSource.tokens.mockReturnValue({
      accessToken: jwtWithScopes("Files.Read.All Sites.Read.All User.Read"),
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 60 * 60 * 1000,
    });

    await expect(TeamsFilesSource.listChildren(record, "root")).rejects.toThrow(
      TEAMS_CONSENT_MESSAGE
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("fails with a re-consent message when Graph returns 403 for joinedTeams", async () => {
    ConnectedFileSource.tokens.mockReturnValue({
      accessToken: "opaque-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 60 * 60 * 1000,
    });
    global.fetch.mockResolvedValue(jsonErr(403, "Access denied"));

    await expect(TeamsFilesSource.listChildren(record, "root")).rejects.toThrow(
      TEAMS_CONSENT_MESSAGE
    );
  });

  it("deltas a channel files folder via Graph", async () => {
    global.fetch
      .mockResolvedValueOnce(
        jsonOk({
          id: "folder-1",
          name: "General",
          parentReference: { driveId: "d1" },
        })
      )
      .mockResolvedValueOnce(
        jsonOk({
          value: [
            { id: "a", name: "a.txt", file: { mimeType: "text/plain" } },
            { id: "b", name: "gone.md", "@removed": { reason: "deleted" } },
          ],
          "@odata.deltaLink": "https://graph.microsoft.com/delta-link",
        })
      );

    const page = await TeamsFilesSource.delta(
      record,
      "team:t1:channel:c1",
      null
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/drives/d1/items/folder-1/delta"),
      expect.any(Object)
    );
    expect(page.deltaLink).toBe("https://graph.microsoft.com/delta-link");
    expect(page.items).toEqual([
      expect.objectContaining({ id: "drive:d1:item:a", type: "file" }),
      expect.objectContaining({ id: "drive:d1:item:b", deleted: true }),
    ]);
  });
});
