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

const { GoogleDriveSource } = require("../../../utils/fileSources/googleDrive");

describe("GoogleDriveSource.listChanges", () => {
  const record = { id: 1, provider: "google-drive" };

  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("maps removed, trashed, parents, and page tokens", async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        nextPageToken: "page-2",
        newStartPageToken: null,
        changes: [
          { fileId: "gone", removed: true },
          {
            fileId: "trash",
            file: {
              id: "trash",
              name: "old.txt",
              mimeType: "text/plain",
              trashed: true,
              parents: ["folder-1"],
            },
          },
          {
            fileId: "keep",
            file: {
              id: "keep",
              name: "keep.txt",
              mimeType: "text/plain",
              size: "12",
              parents: ["folder-1"],
            },
          },
        ],
      }),
    });

    const page = await GoogleDriveSource.listChanges(record, "page-1");
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/changes?pageToken=page-1"),
      expect.objectContaining({
        headers: { Authorization: "Bearer access-token" },
      })
    );
    expect(page.nextPageToken).toBe("page-2");
    expect(page.items).toEqual([
      { id: "gone", name: "gone", deleted: true },
      { id: "trash", name: "old.txt", deleted: true },
      expect.objectContaining({
        id: "keep",
        type: "file",
        parents: ["folder-1"],
        indexable: true,
      }),
    ]);
  });

  it("surfaces HTTP 410 so adapters can mint a new startPageToken", async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 410,
      json: async () => ({
        error: { message: "The page token is invalid or has expired" },
      }),
    });

    await expect(
      GoogleDriveSource.listChanges(record, "stale")
    ).rejects.toMatchObject({ status: 410 });
  });
});
