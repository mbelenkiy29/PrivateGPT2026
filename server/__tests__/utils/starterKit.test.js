/* eslint-env jest */

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

describe("StarterKit catalog", () => {
  it("ships six kits with required fields", () => {
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
    expect(StarterKit.get("legal-lite").queryRefusalResponse).toMatch(
      /legal advice/i
    );
    expect(StarterKit.get("clinic-sops").openAiPrompt).toMatch(/PHI/i);
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
  });

  it("creates a workspace, suggested messages, and grounded-only embed", async () => {
    Workspace.new.mockResolvedValue({
      workspace: { id: 9, slug: "customer-support", name: "Customer Support" },
      message: null,
    });
    WorkspaceSuggestedMessages.saveAll.mockResolvedValue();
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
        openAiPrompt: expect.any(String),
        queryRefusalResponse: expect.any(String),
      })
    );
    expect(WorkspaceSuggestedMessages.saveAll).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ heading: "Hours" }),
      ]),
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

  it("skips embed for sales-proposals unless requested", async () => {
    Workspace.new.mockResolvedValue({
      workspace: { id: 4, slug: "sales-proposals", name: "Sales Proposals" },
      message: null,
    });
    WorkspaceSuggestedMessages.saveAll.mockResolvedValue();

    const result = await StarterKit.install("sales-proposals");
    expect(EmbedConfig.new).not.toHaveBeenCalled();
    expect(result.embed).toBeNull();
  });

  it("returns an error for an unknown kit", async () => {
    const result = await StarterKit.install("not-a-kit");
    expect(result.workspace).toBeNull();
    expect(result.message).toMatch(/unknown/i);
    expect(Workspace.new).not.toHaveBeenCalled();
  });
});
