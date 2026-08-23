/* eslint-env jest */
const fs = require("fs");

jest.mock(
  "uuid",
  () => ({ v4: () => "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }),
  { virtual: true }
);

jest.mock("../../../utils/files", () => ({
  hotdirPath: "/tmp/knowledge-source-hotdir",
}));

jest.mock("../../../models/workspace", () => ({
  Workspace: { get: jest.fn() },
}));

const mockAddDocuments = jest.fn();
jest.mock("../../../models/documents", () => ({
  Document: { addDocuments: mockAddDocuments },
}));

const mockProcessDocument = jest.fn();
jest.mock("../../../utils/collectorApi", () => ({
  CollectorApi: jest.fn(() => ({
    processDocument: mockProcessDocument,
  })),
}));

const {
  embedRemoteFileBuffers,
} = require("../../../utils/fileSources/indexFiles");

describe("embedRemoteFileBuffers", () => {
  const workspace = { id: 3, slug: "team" };

  beforeEach(() => {
    jest.clearAllMocks();
    fs.existsSync = jest.fn().mockReturnValue(true);
    fs.mkdirSync = jest.fn();
    fs.writeFileSync = jest.fn();
  });

  it("passes chunkSource through processDocument and addDocuments", async () => {
    mockProcessDocument.mockResolvedValue({
      success: true,
      documents: [{ location: "custom-documents/doc.json" }],
    });
    mockAddDocuments.mockResolvedValue({ failed: [], embedded: [] });

    const result = await embedRemoteFileBuffers({
      files: [
        {
          name: "spec.txt",
          buffer: Buffer.from("hello"),
          chunkSource: "gdrive://file-1",
        },
      ],
      workspace,
      docAuthor: "drive",
      description: "Synced from Drive",
      docSource: "google-drive",
    });

    expect(mockProcessDocument).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        title: "spec.txt",
        chunkSource: "gdrive://file-1",
        docSource: "gdrive://file-1",
      })
    );
    expect(mockAddDocuments).toHaveBeenCalledWith(workspace, [
      "custom-documents/doc.json",
    ]);
    expect(result.indexed).toBe(1);
    expect(result.failed).toBe(0);
  });
});
