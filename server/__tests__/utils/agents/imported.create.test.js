const os = require("os");
const fs = require("fs");
const path = require("path");

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pgpt-skills-"));
process.env.NODE_ENV = "test";
process.env.STORAGE_DIR = tmpRoot;

const ImportedPlugin = require("../../../utils/agents/imported");

describe("ImportedPlugin.createFromSpec / importFromZipBuffer", () => {
  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("writes plugin.json and handler.js under a safe hubId", () => {
    const result = ImportedPlugin.createFromSpec({
      name: "Lookup Weather",
      description: "Gets weather for a location",
      params: {
        city: { description: "City name", type: "string" },
      },
    });
    expect(result.success).toBe(true);
    expect(result.plugin.hubId).toBe("lookup-weather");
    expect(result.plugin.active).toBe(false);
    const dir = path.join(tmpRoot, "plugins", "agent-skills", "lookup-weather");
    expect(fs.existsSync(path.join(dir, "plugin.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "handler.js"))).toBe(true);
  });

  it("rejects a colliding hubId", () => {
    const result = ImportedPlugin.createFromSpec({
      name: "Lookup Weather",
      description: "duplicate",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/already exists/i);
  });

  it("rejects handler.js that does not export", () => {
    const result = ImportedPlugin.createFromSpec({
      name: "Bad Handler",
      description: "no export",
      handler: "console.log('nope')",
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/module\.exports/);
  });

  it("rejects zip entries that escape the skill folder", () => {
    const AdmZip = require("adm-zip");
    const zip = new AdmZip();
    zip.addFile(
      "plugin.json",
      Buffer.from(
        JSON.stringify({
          hubId: "evil-skill",
          name: "Evil",
          description: "nope",
        })
      )
    );
    zip.addFile("handler.js", Buffer.from("module.exports.runtime = {};"));
    const escapeEntry = zip.addFile(
      "nested/payload.js",
      Buffer.from("escaped")
    );
    escapeEntry.entryName = "../../escape.js";
    const result = ImportedPlugin.importFromZipBuffer(zip.toBuffer());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/outside/i);
  });

  it("imports a valid zip as an inactive skill", () => {
    const AdmZip = require("adm-zip");
    const zip = new AdmZip();
    zip.addFile(
      "plugin.json",
      Buffer.from(
        JSON.stringify({
          hubId: "zip-skill",
          name: "Zip Skill",
          description: "from zip",
          schema: "skill-1.0.0",
          version: "1.0.0",
          entrypoint: { file: "handler.js", params: {} },
        })
      )
    );
    zip.addFile(
      "handler.js",
      Buffer.from("module.exports.runtime = { handler: async () => 'ok' };")
    );
    const result = ImportedPlugin.importFromZipBuffer(zip.toBuffer());
    expect(result.success).toBe(true);
    expect(result.plugin.active).toBe(false);
    expect(result.plugin.hubId).toBe("zip-skill");
  });
});
