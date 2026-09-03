const {
  assertTenant,
  tenantPath,
  vectorNamespace,
  usernameFromEmail,
  emailIsValid,
  normalizeEmail,
  slugifyOrgName,
  setCachedDefaultOrgId,
  jwtPayload,
  sessionUserPayload,
} = require("../../utils/tenant");

describe("tenant helpers", () => {
  test("assertTenant requires organizationId", () => {
    expect(() => assertTenant({ slug: "sales" })).toThrow(/organizationId/);
    expect(assertTenant({ slug: "sales" }, 3)).toEqual({
      slug: "sales",
      organizationId: 3,
    });
  });

  test("slugifyOrgName is stable and lowercase", () => {
    expect(slugifyOrgName("Acme Inc")).toBe("acme-inc");
  });

  test("email helpers", () => {
    expect(emailIsValid("not-an-email")).toBe(false);
    expect(emailIsValid("Ada@Acme.com")).toBe(true);
    expect(normalizeEmail("Ada@Acme.com")).toBe("ada@acme.com");
  });

  test("usernameFromEmail sanitizes local part", () => {
    expect(usernameFromEmail("Ada.O'Neil@acme.com")).toMatch(/^ada/);
  });

  test("tenantPath keeps default org on legacy storage", () => {
    const root = tenantPath({ slug: "default" }, "documents");
    expect(root.endsWith("/documents")).toBe(true);
    expect(root.includes("/tenants/")).toBe(false);
  });

  test("tenantPath prefixes non-default orgs", () => {
    const root = tenantPath({ slug: "acme" }, "documents");
    expect(root.includes("/tenants/acme/documents")).toBe(true);
  });

  test("vectorNamespace keeps default org tables unprefixed", () => {
    setCachedDefaultOrgId(1);
    expect(
      vectorNamespace({ slug: "sales", organizationId: 1, organizationSlug: "default" })
    ).toBe("sales");
    expect(vectorNamespace({ slug: "sales", organizationId: 9 })).toBe(
      "org9__sales"
    );
  });

  test("jwt and session payloads include tenant", () => {
    const user = { id: 4, username: "ada", password: "secret", role: "default" };
    const org = { id: 2, name: "Acme", slug: "acme", status: "active" };
    expect(jwtPayload(user, org)).toEqual({
      id: 4,
      username: "ada",
      tenantId: 2,
    });
    const payload = sessionUserPayload(user, { role: "admin" }, org);
    expect(payload.password).toBeUndefined();
    expect(payload.role).toBe("admin");
    expect(payload.organization.slug).toBe("acme");
  });
});
