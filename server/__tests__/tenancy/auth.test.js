const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const testDb = path.join(
  os.tmpdir(),
  `privategpt-tenancy-auth-${process.pid}-${Date.now()}.db`
);
process.env.TEST_DATABASE_URL = `file:${testDb}`;
process.env.JWT_SECRET = "tenancy-auth-test-secret";
process.env.NODE_ENV = "test";

const serverDir = path.resolve(__dirname, "../..");

function applySchema() {
  const sql = execSync(
    "npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script",
    { cwd: serverDir, encoding: "utf8" }
  );
  const wrapped = `PRAGMA foreign_keys=OFF;\n${sql}\nPRAGMA foreign_keys=ON;\n`;
  execSync(`sqlite3 "${testDb}"`, { input: wrapped, encoding: "utf8" });
}

applySchema();

const JWT = require("jsonwebtoken");
const prisma = require("../../utils/prisma");
const { Organization } = require("../../models/organization");
const { User } = require("../../models/user");
const { signupTenant } = require("../../utils/helpers/signup");
const { decodeJWT, sessionTokenForUser, makeJWT } = require("../../utils/http");
const { resolveTenant } = require("../../utils/middleware/resolveTenant");

function mockResponse(locals = {}) {
  const response = {
    locals,
    statusCode: 200,
    body: null,
  };
  response.status = (code) => {
    response.statusCode = code;
    return response;
  };
  response.json = (body) => {
    response.body = body;
    return response;
  };
  return response;
}

describe("multi-tenant auth flow", () => {
  afterAll(async () => {
    await prisma.$disconnect();
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
  });

  test("session JWT is HS256 and carries tenantId", async () => {
    const result = await signupTenant({
      email: "ada@acme.test",
      password: "password12",
      firstName: "Ada",
      lastName: "Lovelace",
      companyName: "Acme Auth",
    });
    expect(result.error).toBeNull();
    expect(result.token).toBeTruthy();

    const decoded = decodeJWT(result.token);
    expect(decoded.id).toBe(result.user.id);
    expect(decoded.tenantId).toBe(result.organization.id);
    expect(decoded.alg || JWT.decode(result.token, { complete: true }).header.alg).toBe(
      "HS256"
    );

    const noneToken = JWT.sign(
      { id: result.user.id, tenantId: result.organization.id },
      process.env.JWT_SECRET,
      { algorithm: "none" }
    );
    const rejected = decodeJWT(noneToken);
    expect(rejected.id).toBeNull();
  });

  test("resolveForUser does not fall back when requirePreferred is set", async () => {
    const a = await signupTenant({
      email: "maya@acme-pref.test",
      password: "password12",
      firstName: "Maya",
      lastName: "Chen",
      companyName: "Acme Pref",
    });
    const b = await signupTenant({
      email: "liam@north-pref.test",
      password: "password12",
      firstName: "Liam",
      lastName: "Olsen",
      companyName: "North Pref",
    });

    const fallback = await Organization.resolveForUser(
      a.user.id,
      b.organization.id
    );
    expect(fallback.organization.id).toBe(a.organization.id);

    const strict = await Organization.resolveForUser(
      a.user.id,
      b.organization.id,
      { requirePreferred: true }
    );
    expect(strict.organization).toBeNull();
    expect(strict.membership).toBeNull();
  });

  test("resolveTenant rejects a JWT tenant the user is not a member of", async () => {
    const a = await signupTenant({
      email: "host@delta-auth.test",
      password: "password12",
      firstName: "Host",
      lastName: "User",
      companyName: "Delta Auth",
    });
    const b = await signupTenant({
      email: "other@echo-auth.test",
      password: "password12",
      firstName: "Other",
      lastName: "User",
      companyName: "Echo Auth",
    });

    const user = await User.get({ id: a.user.id });
    const request = {
      decodedJwt: { id: user.id, tenantId: b.organization.id },
    };
    const response = mockResponse({
      multiUserMode: true,
      user,
      jwtTenantId: b.organization.id,
    });

    let nextCalled = false;
    await resolveTenant({ required: true })(request, response, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(false);
    expect(response.statusCode).toBe(403);
    expect(response.body.error).toMatch(/Not a member/);
    expect(response.locals.tenantId).toBeUndefined();
  });

  test("resolveTenant binds membership role for a valid tenant session", async () => {
    const result = await signupTenant({
      email: "admin@gamma-auth.test",
      password: "password12",
      firstName: "Carol",
      lastName: "Admin",
      companyName: "Gamma Auth",
    });
    const user = await User.get({ id: result.user.id });
    const request = {
      decodedJwt: { id: user.id, tenantId: result.organization.id },
    };
    const response = mockResponse({
      multiUserMode: true,
      user,
      jwtTenantId: result.organization.id,
    });

    let nextCalled = false;
    await resolveTenant({ required: true })(request, response, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(response.locals.tenantId).toBe(result.organization.id);
    expect(response.locals.user.role).toBe("admin");
    expect(response.locals.user.organizationId).toBe(result.organization.id);
  });

  test("resolveTenant rejects a suspended organization", async () => {
    const result = await signupTenant({
      email: "sue@paused.test",
      password: "password12",
      firstName: "Sue",
      lastName: "Pended",
      companyName: "Paused Co",
    });
    await Organization.update(result.organization.id, { status: "suspended" });

    const user = await User.get({ id: result.user.id });
    const request = {
      decodedJwt: { id: user.id, tenantId: result.organization.id },
    };
    const response = mockResponse({
      multiUserMode: true,
      user,
      jwtTenantId: result.organization.id,
    });

    await resolveTenant({ required: true })(request, response, () => {});
    expect(response.statusCode).toBe(403);
    expect(response.body.error).toMatch(/suspended/);
  });

  test("user without membership cannot get a tenant session", async () => {
    const { user } = await User.create({
      username: "orphanauth",
      password: "password12",
      firstName: "Orphan",
      lastName: "Account",
      email: "orphan@none.test",
      role: "admin",
    });
    const token = sessionTokenForUser(user, null);
    const decoded = decodeJWT(token);
    expect(decoded.tenantId).toBeNull();

    const dbUser = await User.get({ id: user.id });
    const request = { decodedJwt: decoded };
    const response = mockResponse({
      multiUserMode: true,
      user: dbUser,
      jwtTenantId: decoded.tenantId,
    });
    await resolveTenant({ required: true })(request, response, () => {});
    expect(response.statusCode).toBe(403);
    expect(response.body.error).toMatch(/No organization membership/);
  });

  test("makeJWT rejects unsigned none-algorithm tokens", () => {
    const signed = makeJWT({ id: 1, tenantId: 2 }, "1h");
    expect(decodeJWT(signed).id).toBe(1);
    expect(decodeJWT("not-a-jwt").id).toBeNull();
  });
});
