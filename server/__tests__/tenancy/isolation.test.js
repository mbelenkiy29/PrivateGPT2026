const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const testDb = path.join(
  os.tmpdir(),
  `privategpt-tenancy-${process.pid}-${Date.now()}.db`
);
process.env.TEST_DATABASE_URL = `file:${testDb}`;
process.env.JWT_SECRET = "tenancy-test-secret";
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

const prisma = require("../../utils/prisma");
const { Organization } = require("../../models/organization");
const { User } = require("../../models/user");
const { Workspace } = require("../../models/workspace");
const { Invite } = require("../../models/invite");
const { WorkspaceChats } = require("../../models/workspaceChats");
const { signupTenant } = require("../../utils/helpers/signup");
const { assertTenant } = require("../../utils/tenant");

async function makeOrgAdmin({ email, companyName, firstName = "Ada" }) {
  return signupTenant({
    email,
    password: "password12",
    firstName,
    lastName: "Lovelace",
    companyName,
  });
}

describe("multi-tenant isolation", () => {
  afterAll(async () => {
    await prisma.$disconnect();
    if (fs.existsSync(testDb)) fs.unlinkSync(testDb);
  });

  test("org A cannot list org B users, workspaces, invites, or chats", async () => {
    const a = await makeOrgAdmin({
      email: "ada@acme.test",
      companyName: "Acme",
    });
    const b = await makeOrgAdmin({
      email: "bob@beta.test",
      companyName: "Beta",
      firstName: "Bob",
    });

    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    expect(a.organization.id).not.toBe(b.organization.id);

    const aUsers = await User.whereForOrganization(a.organization.id);
    const bUsers = await User.whereForOrganization(b.organization.id);
    expect(aUsers.map((u) => u.email)).toEqual(["ada@acme.test"]);
    expect(bUsers.map((u) => u.email)).toEqual(["bob@beta.test"]);
    expect(aUsers.find((u) => u.email === "bob@beta.test")).toBeUndefined();

    const aWorkspaces = await Workspace.where(
      assertTenant({}, a.organization.id)
    );
    const bWorkspaces = await Workspace.where(
      assertTenant({}, b.organization.id)
    );
    expect(aWorkspaces.length).toBeGreaterThan(0);
    expect(bWorkspaces.length).toBeGreaterThan(0);
    expect(
      aWorkspaces.find((ws) => ws.organizationId === b.organization.id)
    ).toBeUndefined();
    expect(
      await Workspace.get({
        slug: bWorkspaces[0].slug,
        organizationId: a.organization.id,
      })
    ).toBeNull();

    const { invite } = await Invite.create({
      createdByUserId: a.user.id,
      workspaceIds: aWorkspaces.map((ws) => ws.id),
      organizationId: a.organization.id,
    });
    const aInvites = await Invite.whereForOrganization(a.organization.id);
    const bInvites = await Invite.whereForOrganization(b.organization.id);
    expect(aInvites.map((row) => row.id)).toContain(invite.id);
    expect(bInvites.map((row) => row.id)).not.toContain(invite.id);

    await WorkspaceChats.new({
      workspaceId: aWorkspaces[0].id,
      prompt: "secret from acme",
      response: { text: "ok" },
      user: a.user,
      organizationId: a.organization.id,
    });
    const aChats = await WorkspaceChats.whereForOrganization(a.organization.id);
    const bChats = await WorkspaceChats.whereForOrganization(b.organization.id);
    expect(aChats.some((chat) => chat.prompt === "secret from acme")).toBe(true);
    expect(bChats.some((chat) => chat.prompt === "secret from acme")).toBe(
      false
    );
  });

  test("signup creates an isolated org plus admin membership", async () => {
    const result = await makeOrgAdmin({
      email: "carol@gamma.test",
      companyName: "Gamma Labs",
      firstName: "Carol",
    });
    expect(result.error).toBeNull();
    expect(result.user.role).toBe("admin");
    expect(result.user.organization.slug).toMatch(/gamma/);
    expect(result.token).toBeTruthy();

    const membership = await Organization.membership(
      result.user.id,
      result.organization.id
    );
    expect(membership.role).toBe("admin");

    const workspaces = await Workspace.where({
      organizationId: result.organization.id,
    });
    expect(workspaces.length).toBe(1);
  });

  test("invite claim stays inside the inviting org", async () => {
    const host = await makeOrgAdmin({
      email: "host@delta.test",
      companyName: "Delta",
      firstName: "Host",
    });
    const outsider = await makeOrgAdmin({
      email: "other@echo.test",
      companyName: "Echo",
      firstName: "Other",
    });
    const hostWorkspaces = await Workspace.where({
      organizationId: host.organization.id,
    });
    const outsiderWorkspaces = await Workspace.where({
      organizationId: outsider.organization.id,
    });

    const { invite } = await Invite.create({
      createdByUserId: host.user.id,
      workspaceIds: [
        hostWorkspaces[0].id,
        outsiderWorkspaces[0].id,
      ],
      organizationId: host.organization.id,
    });

    const { user: claimed } = await User.create({
      username: "delta-guest",
      password: "password12",
      firstName: "Guest",
      lastName: "User",
      email: "guest@delta.test",
      role: "default",
    });
    await Invite.markClaimed(invite.id, claimed);

    const membership = await Organization.membership(
      claimed.id,
      host.organization.id
    );
    expect(membership).toBeTruthy();
    expect(membership.role).toBe("default");

    const outsiderMembership = await Organization.membership(
      claimed.id,
      outsider.organization.id
    );
    expect(outsiderMembership).toBeNull();

    const { WorkspaceUser } = require("../../models/workspaceUsers");
    const rels = await WorkspaceUser.where({ user_id: claimed.id });
    const workspaceIds = rels.map((rel) => rel.workspace_id);
    expect(workspaceIds).toContain(hostWorkspaces[0].id);
    expect(workspaceIds).not.toContain(outsiderWorkspaces[0].id);
  });
});
