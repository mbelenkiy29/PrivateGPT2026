/* eslint-env jest */

jest.mock("../../../models/documentSyncQueue", () => {
  const extraFileTypes = [];
  return {
    DocumentSyncQueue: {
      extraFileTypes,
      registerFileType(type) {
        if (!type || extraFileTypes.includes(type)) return false;
        extraFileTypes.push(type);
        return true;
      },
    },
  };
});

jest.mock("../../../utils/fileSources/googleDrive", () => ({
  GoogleDriveSource: {
    listChildren: jest.fn(),
    download: jest.fn(),
    getStartPageToken: jest.fn(),
    listChanges: jest.fn(),
  },
}));

jest.mock("../../../utils/fileSources/onedrive", () => ({
  OneDriveSource: {
    listChildren: jest.fn(),
    download: jest.fn(),
    delta: jest.fn(),
  },
}));

jest.mock("../../../models/connectedFileSource", () => ({
  ConnectedFileSource: {
    providers: { googleDrive: "google-drive", onedrive: "onedrive" },
    get: jest.fn(),
  },
}));

const { GoogleDriveSource } = require("../../../utils/fileSources/googleDrive");
const { OneDriveSource } = require("../../../utils/fileSources/onedrive");
const gdrive = require("../../../utils/knowledgeSources/adapters/gdrive");
const onedrive = require("../../../utils/knowledgeSources/adapters/onedrive");

const driveRecord = { id: 1, provider: "google-drive" };
const oneRecord = { id: 2, provider: "onedrive" };

describe("google-drive knowledge source adapter", () => {
  beforeEach(() => jest.clearAllMocks());

  it("lists children and maps next to cursor", async () => {
    GoogleDriveSource.listChildren.mockResolvedValue({
      items: [{ id: "f1", name: "File", type: "file" }],
      next: "page-2",
    });
    const result = await gdrive.list({
      folderId: "folder-1",
      record: driveRecord,
    });
    expect(GoogleDriveSource.listChildren).toHaveBeenCalledWith(
      driveRecord,
      "folder-1"
    );
    expect(result).toEqual({
      items: [{ id: "f1", name: "File", type: "file" }],
      cursor: "page-2",
    });
  });

  it("downloads by item id", async () => {
    GoogleDriveSource.download.mockResolvedValue({
      kind: "file",
      name: "a.txt",
      buffer: Buffer.from("hi"),
    });
    const file = await gdrive.download({ id: "abc" }, { record: driveRecord });
    expect(GoogleDriveSource.download).toHaveBeenCalledWith(driveRecord, "abc");
    expect(file.name).toBe("a.txt");
  });

  it("delta with no cursor returns startPageToken and no items", async () => {
    GoogleDriveSource.getStartPageToken.mockResolvedValue("start-token");
    const result = await gdrive.delta(null, { record: driveRecord });
    expect(result).toEqual({ items: [], cursor: "start-token" });
    expect(GoogleDriveSource.listChanges).not.toHaveBeenCalled();
  });

  it("delta maps changes.list including deleted remote ids in the watched folder", async () => {
    GoogleDriveSource.listChanges.mockResolvedValue({
      items: [
        {
          id: "keep",
          name: "keep.txt",
          type: "file",
          parents: ["folder-1"],
        },
        { id: "gone", deleted: true },
        {
          id: "other",
          name: "other.txt",
          type: "file",
          parents: ["elsewhere"],
        },
      ],
      nextPageToken: null,
      newStartPageToken: "token-2",
    });
    const result = await gdrive.delta("token-1", {
      record: driveRecord,
      folderId: "folder-1",
    });
    expect(GoogleDriveSource.listChanges).toHaveBeenCalledWith(
      driveRecord,
      "token-1"
    );
    expect(result.cursor).toBe("token-2");
    expect(result.items).toEqual([
      expect.objectContaining({ id: "keep" }),
      expect.objectContaining({ id: "gone", deleted: true }),
    ]);
  });

  it("toChunkSource and watchHint match the contract", () => {
    expect(gdrive.toChunkSource({ id: "file-9" })).toBe("gdrive://file-9");
    expect(gdrive.watchHint()).toEqual({ staleAfterMs: 3600000 });
  });
});

describe("onedrive knowledge source adapter", () => {
  beforeEach(() => jest.clearAllMocks());

  it("lists children and maps next to cursor", async () => {
    OneDriveSource.listChildren.mockResolvedValue({
      items: [{ id: "i1", name: "Doc", type: "file" }],
      next: null,
    });
    const result = await onedrive.list({
      folderId: "folder-9",
      record: oneRecord,
    });
    expect(OneDriveSource.listChildren).toHaveBeenCalledWith(
      oneRecord,
      "folder-9"
    );
    expect(result.items[0].id).toBe("i1");
  });

  it("delta maps Graph folder delta including deleted items", async () => {
    OneDriveSource.delta.mockResolvedValue({
      items: [
        { id: "a", name: "a.txt", type: "file" },
        { id: "b", name: "gone.docx", deleted: true },
      ],
      nextLink: null,
      deltaLink: "https://graph.microsoft.com/delta-link",
    });
    const result = await onedrive.delta(null, {
      record: oneRecord,
      folderId: "folder-9",
    });
    expect(OneDriveSource.delta).toHaveBeenCalledWith(
      oneRecord,
      "folder-9",
      null
    );
    expect(result.cursor).toBe("https://graph.microsoft.com/delta-link");
    expect(result.items).toEqual([
      expect.objectContaining({ id: "a" }),
      expect.objectContaining({ id: "b", deleted: true }),
    ]);
  });

  it("download wraps OneDriveSource.download", async () => {
    OneDriveSource.download.mockResolvedValue({
      kind: "file",
      name: "notes.md",
      buffer: Buffer.from("# hi"),
    });
    const file = await onedrive.download(
      { id: "item-1" },
      { record: oneRecord }
    );
    expect(OneDriveSource.download).toHaveBeenCalledWith(oneRecord, "item-1");
    expect(file.kind).toBe("file");
  });

  it("toChunkSource and watchHint match the contract", () => {
    expect(onedrive.toChunkSource({ id: "item-1" })).toBe("onedrive://item-1");
    expect(onedrive.watchHint()).toEqual({ staleAfterMs: 3600000 });
  });
});
