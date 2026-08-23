/* eslint-env jest */

jest.mock("../../../models/connectedFileSource", () => ({
  ConnectedFileSource: {
    tokens: () => ({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 60 * 60 * 1000,
    }),
    upsertByProvider: jest.fn(),
  },
}));

jest.mock("../../../utils/fileSources/credentials", () => ({
  getFileSourceOAuthConfig: jest.fn(),
}));

const { OneDriveSource } = require("../../../utils/fileSources/onedrive");

describe("OneDriveSource.delta", () => {
  const record = { id: 2, provider: "onedrive" };

  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("maps Graph deleted/@removed items and deltaLink", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        value: [
          {
            id: "a",
            name: "notes.txt",
            file: { mimeType: "text/plain" },
          },
          {
            id: "b",
            name: "gone.docx",
            deleted: { state: "deleted" },
          },
          {
            id: "c",
            name: "removed.md",
            "@removed": { reason: "deleted" },
          },
          {
            id: "d",
            name: "Subfolder",
            folder: {},
          },
        ],
        "@odata.deltaLink": "https://graph.microsoft.com/delta-link",
      }),
    });

    const page = await OneDriveSource.delta(record, "folder-9", null);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/me/drive/items/folder-9/delta"),
      expect.any(Object)
    );
    expect(page.deltaLink).toBe("https://graph.microsoft.com/delta-link");
    expect(page.nextLink).toBeNull();
    expect(page.items).toEqual([
      expect.objectContaining({ id: "a", type: "file", indexable: true }),
      { id: "b", name: "gone.docx", deleted: true },
      { id: "c", name: "removed.md", deleted: true },
      expect.objectContaining({ id: "d", type: "folder" }),
    ]);
  });

  it("follows a nextLink URL and returns the subsequent deltaLink", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        value: [{ id: "z", name: "z.txt", file: { mimeType: "text/plain" } }],
        "@odata.deltaLink": "https://graph.microsoft.com/delta-link",
      }),
    });

    const page = await OneDriveSource.delta(
      record,
      "folder-9",
      "https://graph.microsoft.com/page-2"
    );
    expect(global.fetch).toHaveBeenCalledWith(
      "https://graph.microsoft.com/page-2",
      expect.objectContaining({
        headers: { Authorization: "Bearer access-token" },
      })
    );
    expect(page.deltaLink).toBe("https://graph.microsoft.com/delta-link");
    expect(page.items[0].id).toBe("z");
  });

  it("getDeltaLink walks nextLinks until a deltaLink", async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          value: [],
          "@odata.nextLink": "https://graph.microsoft.com/page-2",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          value: [],
          "@odata.deltaLink": "https://graph.microsoft.com/delta-link",
        }),
      });

    const link = await OneDriveSource.getDeltaLink(record, "folder-9");
    expect(link).toBe("https://graph.microsoft.com/delta-link");
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
