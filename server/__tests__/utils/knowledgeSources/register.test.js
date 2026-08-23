/* eslint-env jest */

jest.mock("../../../models/documentSyncQueue", () => {
  const extraFileTypes = [];
  return {
    DocumentSyncQueue: {
      extraFileTypes,
      maxRepeatFailures: 5,
      registerFileType(type) {
        if (!type || extraFileTypes.includes(type)) return false;
        extraFileTypes.push(type);
        return true;
      },
      canWatch({ chunkSource = null } = {}) {
        if (!chunkSource) return false;
        return extraFileTypes.some((t) => chunkSource.startsWith(`${t}://`));
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

require("../../../utils/knowledgeSources/register");
const {
  getAdapter,
  listProviders,
} = require("../../../utils/knowledgeSources");
const { DocumentSyncQueue } = require("../../../models/documentSyncQueue");

describe("knowledge source adapter auto-registration", () => {
  it("loads every adapters/*.js file and registers google-drive and onedrive", () => {
    const gdrive = getAdapter("google-drive");
    const onedrive = getAdapter("onedrive");
    expect(gdrive).toBeTruthy();
    expect(onedrive).toBeTruthy();
    expect(listProviders()).toEqual(
      expect.arrayContaining(["google-drive", "onedrive"])
    );
    expect(gdrive.toChunkSource({ id: "abc" })).toBe("gdrive://abc");
    expect(onedrive.toChunkSource({ id: "xyz" })).toBe("onedrive://xyz");
    expect(gdrive.watchHint()).toEqual({ staleAfterMs: 3600000 });
    expect(onedrive.watchHint()).toEqual({ staleAfterMs: 3600000 });
    expect(DocumentSyncQueue.canWatch({ chunkSource: "gdrive://abc" })).toBe(
      true
    );
    expect(DocumentSyncQueue.canWatch({ chunkSource: "onedrive://xyz" })).toBe(
      true
    );
  });
});
