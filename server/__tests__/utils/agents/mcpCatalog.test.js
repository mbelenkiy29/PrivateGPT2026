const {
  buildServerDefinition,
  packageFromArgs,
  ALLOWED_PACKAGES,
  getEntry,
} = require("../../../utils/agents/mcpCatalog");

describe("mcpCatalog.buildServerDefinition", () => {
  it("rejects unknown catalog ids", () => {
    const result = buildServerDefinition("not-a-server", {});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not in the catalog/i);
  });

  it("requires listed secrets", () => {
    const result = buildServerDefinition("github", {});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/required/i);
  });

  it("builds a stopped GitHub stdio server from the allowlist", () => {
    const result = buildServerDefinition("github", {
      GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_test",
    });
    expect(result.success).toBe(true);
    expect(result.name).toBe("github");
    expect(result.server.command).toBe("npx");
    expect(packageFromArgs(result.server.args)).toBe(
      "@modelcontextprotocol/server-github"
    );
    expect(ALLOWED_PACKAGES.has(packageFromArgs(result.server.args))).toBe(
      true
    );
    expect(result.server.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe("ghp_test");
    expect(result.server.anythingllm.autoStart).toBe(false);
  });

  it("does not let form values replace the allowlisted package", () => {
    const entry = getEntry("filesystem");
    const result = buildServerDefinition("filesystem", {
      rootPath: "@evil/not-allowed",
    });
    expect(result.success).toBe(true);
    expect(packageFromArgs(result.server.args)).toBe(
      packageFromArgs(entry.args)
    );
    expect(result.server.args.at(-1)).toBe("@evil/not-allowed");
  });

  it("rejects a non-http remote URL", () => {
    const result = buildServerDefinition("remote-http", {
      url: "file:///etc/passwd",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/http/i);
  });

  it("builds a remote HTTP server with autoStart false", () => {
    const result = buildServerDefinition("remote-http", {
      url: "https://mcp.example.com/mcp",
      Authorization: "Bearer secret",
    });
    expect(result.success).toBe(true);
    expect(result.server.type).toBe("streamable");
    expect(result.server.url).toBe("https://mcp.example.com/mcp");
    expect(result.server.headers.Authorization).toBe("Bearer secret");
    expect(result.server.anythingllm.autoStart).toBe(false);
  });
});
