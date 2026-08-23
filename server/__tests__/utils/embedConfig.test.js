/* eslint-env jest, node */

jest.mock("uuid", () => ({ v4: () => "embed-uuid" }), { virtual: true });
jest.mock("../../utils/prisma", () => ({
  embed_configs: {
    create: jest.fn(),
  },
}));

const prisma = require("../../utils/prisma");
const { EmbedConfig } = require("../../models/embedConfig");

describe("EmbedConfig.new SMB fields", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.embed_configs.create.mockResolvedValue({
      uuid: "embed-uuid",
      allowlist_domains: null,
    });
  });

  it("persists SMB keys when they are present on create", async () => {
    await EmbedConfig.new({
      workspace_id: 3,
      grounded_only: true,
      ai_disclosure: false,
      show_handoff: true,
      handoff_email: "owner@example.com",
      lead_capture: true,
      business_hours_json: { timezone: "UTC" },
    });

    expect(prisma.embed_configs.create).toHaveBeenCalledTimes(1);
    expect(prisma.embed_configs.create.mock.calls[0][0].data).toEqual(
      expect.objectContaining({
        grounded_only: true,
        ai_disclosure: false,
        show_handoff: true,
        handoff_email: "owner@example.com",
        lead_capture: true,
        business_hours_json: JSON.stringify({ timezone: "UTC" }),
      })
    );
  });

  it("omits SMB keys when absent so Prisma defaults apply", async () => {
    await EmbedConfig.new({ workspace_id: 3 });

    const { data } = prisma.embed_configs.create.mock.calls[0][0];
    expect(data).not.toHaveProperty("ai_disclosure");
    expect(data).not.toHaveProperty("show_handoff");
    expect(data).not.toHaveProperty("handoff_email");
    expect(data).not.toHaveProperty("lead_capture");
    expect(data).not.toHaveProperty("business_hours_json");
    expect(data).not.toHaveProperty("grounded_only");
  });
});
