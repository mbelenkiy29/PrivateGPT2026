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
const { SharePointSource } = require("../../../utils/fileSources/sharepoint");
const { parseLocator } = require("../../../utils/fileSources/graphLocators");
const {
  SITES_CONSENT_MESSAGE,
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

describe("SharePointSource", () => {
  const record = { id: 3, provider: "sharepoint" };

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
    ConnectedFileSource.tokens.mockReturnValue({
      accessToken: jwtWithScopes("Files.Read.All Sites.Read.All User.Read"),
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

  it("builds an auth URL from the same Azure app with Sites.Read.All and consent", async () => {
    const result = await SharePointSource.authUrl(
      "http://localhost:3002/api/file-sources/sharepoint/callback",
      "state-1"
    );
    expect(result.success).toBe(true);
    const url = new URL(result.url);
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("scope")).toContain("Sites.Read.All");
    expect(url.searchParams.get("scope")).toContain("Files.Read.All");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("parses drive and site locators", () => {
    expect(parseLocator("root")).toEqual({ kind: "root" });
    expect(parseLocator("site:abc")).toEqual({ kind: "site", siteId: "abc" });
    expect(parseLocator("drive:d1")).toEqual({
      kind: "drive",
      driveId: "d1",
      itemId: "root",
    });
    expect(parseLocator("drive:d1:item:i9")).toEqual({
      kind: "item",
      driveId: "d1",
      itemId: "i9",
    });
  });

  it("lists sites at root via Graph search", async () => {
    global.fetch.mockResolvedValue(
      jsonOk({
        value: [
          {
            id: "site-1",
            displayName: "HR",
            webUrl: "https://contoso.sharepoint.com/hr",
          },
        ],
      })
    );

    const page = await SharePointSource.listChildren(record, "root");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/sites?search=*"),
      expect.any(Object)
    );
    expect(page.items).toEqual([
      expect.objectContaining({
        id: "site:site-1",
        name: "HR",
        type: "folder",
        siteId: "site-1",
      }),
    ]);
  });

  it("lists document libraries for a site", async () => {
    global.fetch.mockResolvedValue(
      jsonOk({
        value: [{ id: "d1", name: "Documents", webUrl: "https://sp/docs" }],
      })
    );

    const page = await SharePointSource.listChildren(record, "site:site-1");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/sites/site-1/drives"),
      expect.any(Object)
    );
    expect(page.items[0]).toEqual(
      expect.objectContaining({
        id: "drive:d1",
        name: "Documents",
        driveId: "d1",
        itemId: "root",
      })
    );
  });

  it("lists library files with composite ids and reuses OneDrive download", async () => {
    global.fetch
      .mockResolvedValueOnce(
        jsonOk({
          value: [
            {
              id: "i1",
              name: "policy.docx",
              file: { mimeType: "application/vnd.openxmlformats" },
              size: 12,
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        jsonOk({
          id: "i1",
          name: "policy.docx",
          file: { mimeType: "application/vnd.openxmlformats" },
        })
      )
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => Buffer.from("docx"),
      });

    const listed = await SharePointSource.listChildren(record, "drive:d1");
    expect(listed.items[0].id).toBe("drive:d1:item:i1");

    const file = await SharePointSource.download(record, listed.items[0].id);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/drives/d1/items/i1/content"),
      expect.any(Object)
    );
    expect(file).toEqual(
      expect.objectContaining({
        kind: "file",
        name: "policy.docx",
        driveId: "d1",
        itemId: "i1",
      })
    );
    expect(Buffer.isBuffer(file.buffer)).toBe(true);
  });

  it("fails with a re-consent message when Sites.Read.All is missing from the token", async () => {
    ConnectedFileSource.tokens.mockReturnValue({
      accessToken: jwtWithScopes("Files.Read User.Read"),
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 60 * 60 * 1000,
    });

    await expect(SharePointSource.listChildren(record, "root")).rejects.toThrow(
      SITES_CONSENT_MESSAGE
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("fails with a re-consent message when Graph returns 403 for sites", async () => {
    ConnectedFileSource.tokens.mockReturnValue({
      accessToken: "opaque-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 60 * 60 * 1000,
    });
    global.fetch.mockResolvedValue(jsonErr(403, "Access denied"));

    await expect(SharePointSource.listChildren(record, "root")).rejects.toThrow(
      SITES_CONSENT_MESSAGE
    );
  });

  it("maps Graph library delta including deleted items", async () => {
    global.fetch.mockResolvedValue(
      jsonOk({
        value: [
          { id: "a", name: "a.txt", file: { mimeType: "text/plain" } },
          { id: "b", name: "gone.docx", deleted: { state: "deleted" } },
        ],
        "@odata.deltaLink": "https://graph.microsoft.com/delta-link",
      })
    );

    const page = await SharePointSource.delta(record, "drive:d1", null);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/drives/d1/root/delta"),
      expect.any(Object)
    );
    expect(page.deltaLink).toBe("https://graph.microsoft.com/delta-link");
    expect(page.items).toEqual([
      expect.objectContaining({
        id: "drive:d1:item:a",
        type: "file",
        indexable: true,
      }),
      expect.objectContaining({
        id: "drive:d1:item:b",
        deleted: true,
      }),
    ]);
  });
});
