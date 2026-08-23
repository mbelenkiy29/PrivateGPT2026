/* eslint-env jest */
const fs = require("fs");
const path = require("path");

jest.mock("../../models/workspace", () => ({
  Workspace: {
    new: jest.fn(),
  },
}));
jest.mock("../../models/workspacesSuggestedMessages", () => ({
  WorkspaceSuggestedMessages: {
    saveAll: jest.fn(),
  },
}));
jest.mock("../../models/embedConfig", () => ({
  EmbedConfig: {
    new: jest.fn(),
  },
}));

const { StarterKit } = require("../../models/starterKit");
const { Workspace } = require("../../models/workspace");
const {
  WorkspaceSuggestedMessages,
} = require("../../models/workspacesSuggestedMessages");
const { EmbedConfig } = require("../../models/embedConfig");

const EXPECTED_IDS = [
  "clinic-sops",
  "customer-support",
  "employee-handbook",
  "invoice-qa",
  "legal-lite",
  "sales-proposals",
];

const KITS_DIR = path.resolve(__dirname, "../../utils/starterKits/kits");

describe("StarterKit catalog", () => {
  it("ships six kits from utils, not storage", () => {
    expect(fs.existsSync(path.join(KITS_DIR, "customer-support.json"))).toBe(
      true
    );
    expect(
      fs.existsSync(
        path.resolve(
          __dirname,
          "../../storage/starter-kits/customer-support.json"
        )
      )
    ).toBe(false);

    const kits = StarterKit.list();
    expect(kits.map((kit) => kit.id).sort()).toEqual(EXPECTED_IDS);

    for (const summary of kits) {
      const kit = StarterKit.get(summary.id);
      expect(kit.name).toBeTruthy();
      expect(["chat", "query"]).toContain(kit.chatMode);
      expect(kit.openAiPrompt).toBeTruthy();
      expect(kit.suggestedMessages.length).toBeGreaterThan(0);
    }
  });

  it("customer-support is query mode with hours/refunds/shipping prompts", () => {
    const kit = StarterKit.get("customer-support");
    expect(kit.chatMode).toBe("query");
    expect(kit.createEmbed).toBe(true);
    expect(kit.queryRefusalResponse).toMatch(/support/i);
    const text = kit.suggestedMessages
      .map((msg) => `${msg.heading} ${msg.message}`)
      .join(" ")
      .toLowerCase();
    expect(text).toMatch(/hours/);
    expect(text).toMatch(/refund/);
    expect(text).toMatch(/shipping/);
  });

  it("sales-proposals is chat mode and legal-lite refuses legal advice", () => {
    expect(StarterKit.get("sales-proposals").chatMode).toBe("chat");
    expect(StarterKit.get("sales-proposals").createEmbed).toBe(false);
    const legal = StarterKit.get("legal-lite");
    expect(legal.queryRefusalResponse).toMatch(/legal advice/i);
    expect(legal.queryRefusalResponse).toMatch(/draft/i);
    expect(legal.openAiPrompt).not.toMatch(/sample language/i);
    expect(legal.openAiPrompt).toMatch(/Do not draft replacement language/i);
    expect(StarterKit.get("clinic-sops").openAiPrompt).toMatch(/PHI/i);
    expect(StarterKit.get("invoice-qa").openAiPrompt).toMatch(/table/i);
  });

  it("rejects unknown or unsafe kit ids", () => {
    expect(StarterKit.get("../workspace")).toBeNull();
    expect(StarterKit.get("missing-kit")).toBeNull();
  });
});

describe("StarterKit.install", () => {
  beforeEach(() => {
    Workspace.new.mockReset();
    WorkspaceSuggestedMessages.saveAll.mockReset();
    EmbedConfig.new.mockReset();
    WorkspaceSuggestedMessages.saveAll.mockResolvedValue({
      success: true,
      error: null,
    });
  });

  it("creates a workspace, suggested messages, and grounded-only embed", async () => {
    const kit = StarterKit.get("customer-support");
    Workspace.new.mockResolvedValue({
      workspace: { id: 9, slug: "customer-support", name: "Customer Support" },
      message: null,
    });
    EmbedConfig.new.mockResolvedValue({
      embed: { id: 3, grounded_only: true },
      message: null,
    });

    const result = await StarterKit.install("customer-support", { userId: 2 });

    expect(Workspace.new).toHaveBeenCalledWith(
      "Customer Support",
      2,
      expect.objectContaining({
        chatMode: "query",
        openAiPrompt: kit.openAiPrompt,
        queryRefusalResponse: kit.queryRefusalResponse,
      })
    );
    expect(WorkspaceSuggestedMessages.saveAll).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ heading: "Hours" })]),
      "customer-support"
    );
    expect(EmbedConfig.new).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: 9,
        chat_mode: "query",
        grounded_only: true,
        enabled: true,
      }),
      2
    );
    expect(result.workspace.slug).toBe("customer-support");
    expect(result.embed.id).toBe(3);
    expect(result.message).toBeNull();
  });

  it("pins legal-lite refusal text on Workspace.new", async () => {
    const kit = StarterKit.get("legal-lite");
    Workspace.new.mockResolvedValue({
      workspace: { id: 8, slug: "legal-lite", name: "Legal Lite" },
      message: null,
    });
    EmbedConfig.new.mockResolvedValue({
      embed: { id: 4, grounded_only: true },
      message: null,
    });

    await StarterKit.install("legal-lite");
    expect(Workspace.new).toHaveBeenCalledWith(
      "Legal Lite",
      null,
      expect.objectContaining({
        chatMode: "query",
        openAiPrompt: kit.openAiPrompt,
        queryRefusalResponse: kit.queryRefusalResponse,
      })
    );
  });

  it("installs invoice-qa with table-extract instruction", async () => {
    const kit = StarterKit.get("invoice-qa");
    Workspace.new.mockResolvedValue({
      workspace: { id: 5, slug: "invoice-qa", name: "Invoice Q&A" },
      message: null,
    });
    EmbedConfig.new.mockResolvedValue({
      embed: { id: 6, grounded_only: true },
      message: null,
    });

    await StarterKit.install("invoice-qa");
    expect(Workspace.new.mock.calls[0][2].openAiPrompt).toMatch(/table/i);
    expect(Workspace.new.mock.calls[0][2].openAiPrompt).toBe(kit.openAiPrompt);
  });

  it("skips embed for sales-proposals unless requested", async () => {
    Workspace.new.mockResolvedValue({
      workspace: { id: 4, slug: "sales-proposals", name: "Sales Proposals" },
      message: null,
    });

    const skipped = await StarterKit.install("sales-proposals");
    expect(EmbedConfig.new).not.toHaveBeenCalled();
    expect(skipped.embed).toBeNull();
    expect(skipped.message).toBeNull();

    EmbedConfig.new.mockResolvedValue({
      embed: { id: 11, grounded_only: true },
      message: null,
    });
    const forced = await StarterKit.install("sales-proposals", {
      createEmbed: true,
    });
    expect(EmbedConfig.new).toHaveBeenCalled();
    expect(forced.embed.id).toBe(11);
  });

  it("returns an error when embed create fails", async () => {
    Workspace.new.mockResolvedValue({
      workspace: { id: 9, slug: "customer-support", name: "Customer Support" },
      message: null,
    });
    EmbedConfig.new.mockResolvedValue({
      embed: null,
      message: "embed insert failed",
    });

    const result = await StarterKit.install("customer-support");
    expect(result.workspace.slug).toBe("customer-support");
    expect(result.embed).toBeNull();
    expect(result.message).toMatch(/embed insert failed/);
  });

  it("returns an error when suggested messages fail to save", async () => {
    Workspace.new.mockResolvedValue({
      workspace: { id: 9, slug: "customer-support", name: "Customer Support" },
      message: null,
    });
    WorkspaceSuggestedMessages.saveAll.mockResolvedValue({
      success: false,
      error: "db write failed",
    });

    const result = await StarterKit.install("customer-support");
    expect(EmbedConfig.new).not.toHaveBeenCalled();
    expect(result.message).toMatch(/db write failed/);
  });

  it("returns an error for an unknown kit", async () => {
    const result = await StarterKit.install("not-a-kit");
    expect(result.workspace).toBeNull();
    expect(result.message).toMatch(/unknown/i);
    expect(Workspace.new).not.toHaveBeenCalled();
  });
});
