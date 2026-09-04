-- CreateTable
CREATE TABLE "organizations" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "organization_users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "organizationId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'default',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "organization_users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "organization_users_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "tenant_settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "organizationId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tenant_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "organization_users_organizationId_userId_key" ON "organization_users"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "organization_users_userId_idx" ON "organization_users"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_settings_organizationId_label_key" ON "tenant_settings"("organizationId", "label");

-- AlterTable
ALTER TABLE "users" ADD COLUMN "email" TEXT;
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- Default organization for existing instance data
INSERT INTO "organizations" ("name", "slug", "status", "createdAt", "lastUpdatedAt")
VALUES ('Default', 'default', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Tenant columns on existing tables
ALTER TABLE "api_keys" ADD COLUMN "organizationId" INTEGER;
ALTER TABLE "invites" ADD COLUMN "organizationId" INTEGER;
ALTER TABLE "workspaces" ADD COLUMN "organizationId" INTEGER;
ALTER TABLE "workspace_chats" ADD COLUMN "organizationId" INTEGER;
ALTER TABLE "embed_configs" ADD COLUMN "organizationId" INTEGER;
ALTER TABLE "external_communication_connectors" ADD COLUMN "organizationId" INTEGER;
ALTER TABLE "scheduled_jobs" ADD COLUMN "organizationId" INTEGER;
ALTER TABLE "memories" ADD COLUMN "organizationId" INTEGER;
ALTER TABLE "model_routers" ADD COLUMN "organizationId" INTEGER;
ALTER TABLE "connected_file_sources" ADD COLUMN "organizationId" INTEGER;
ALTER TABLE "knowledge_sources" ADD COLUMN "organizationId" INTEGER;
ALTER TABLE "usage_events" ADD COLUMN "organizationId" INTEGER;
ALTER TABLE "tickets" ADD COLUMN "organizationId" INTEGER;

-- Backfill existing rows onto the default organization
UPDATE "api_keys" SET "organizationId" = (SELECT "id" FROM "organizations" WHERE "slug" = 'default' LIMIT 1) WHERE "organizationId" IS NULL;
UPDATE "invites" SET "organizationId" = (SELECT "id" FROM "organizations" WHERE "slug" = 'default' LIMIT 1) WHERE "organizationId" IS NULL;
UPDATE "workspaces" SET "organizationId" = (SELECT "id" FROM "organizations" WHERE "slug" = 'default' LIMIT 1) WHERE "organizationId" IS NULL;
UPDATE "workspace_chats" SET "organizationId" = (SELECT "id" FROM "organizations" WHERE "slug" = 'default' LIMIT 1) WHERE "organizationId" IS NULL;
UPDATE "embed_configs" SET "organizationId" = (SELECT "id" FROM "organizations" WHERE "slug" = 'default' LIMIT 1) WHERE "organizationId" IS NULL;
UPDATE "external_communication_connectors" SET "organizationId" = (SELECT "id" FROM "organizations" WHERE "slug" = 'default' LIMIT 1) WHERE "organizationId" IS NULL;
UPDATE "scheduled_jobs" SET "organizationId" = (SELECT "id" FROM "organizations" WHERE "slug" = 'default' LIMIT 1) WHERE "organizationId" IS NULL;
UPDATE "memories" SET "organizationId" = (SELECT "id" FROM "organizations" WHERE "slug" = 'default' LIMIT 1) WHERE "organizationId" IS NULL;
UPDATE "model_routers" SET "organizationId" = (SELECT "id" FROM "organizations" WHERE "slug" = 'default' LIMIT 1) WHERE "organizationId" IS NULL;
UPDATE "connected_file_sources" SET "organizationId" = (SELECT "id" FROM "organizations" WHERE "slug" = 'default' LIMIT 1) WHERE "organizationId" IS NULL;
UPDATE "knowledge_sources" SET "organizationId" = (SELECT "id" FROM "organizations" WHERE "slug" = 'default' LIMIT 1) WHERE "organizationId" IS NULL;
UPDATE "usage_events" SET "organizationId" = (SELECT "id" FROM "organizations" WHERE "slug" = 'default' LIMIT 1) WHERE "organizationId" IS NULL;
UPDATE "tickets" SET "organizationId" = (SELECT "id" FROM "organizations" WHERE "slug" = 'default' LIMIT 1) WHERE "organizationId" IS NULL;

INSERT INTO "organization_users" ("organizationId", "userId", "role", "createdAt")
SELECT (SELECT "id" FROM "organizations" WHERE "slug" = 'default' LIMIT 1), "id", COALESCE("role", 'default'), CURRENT_TIMESTAMP
FROM "users";

-- Tenant indexes
CREATE INDEX "api_keys_organizationId_idx" ON "api_keys"("organizationId");
CREATE INDEX "invites_organizationId_idx" ON "invites"("organizationId");
CREATE INDEX "workspaces_organizationId_idx" ON "workspaces"("organizationId");
CREATE INDEX "workspace_chats_organizationId_idx" ON "workspace_chats"("organizationId");
CREATE INDEX "embed_configs_organizationId_idx" ON "embed_configs"("organizationId");
CREATE INDEX "external_communication_connectors_organizationId_idx" ON "external_communication_connectors"("organizationId");
CREATE INDEX "scheduled_jobs_organizationId_idx" ON "scheduled_jobs"("organizationId");
CREATE INDEX "memories_organizationId_idx" ON "memories"("organizationId");
CREATE INDEX "model_routers_organizationId_idx" ON "model_routers"("organizationId");
CREATE INDEX "connected_file_sources_organizationId_idx" ON "connected_file_sources"("organizationId");
CREATE INDEX "knowledge_sources_organizationId_idx" ON "knowledge_sources"("organizationId");
CREATE INDEX "usage_events_organizationId_idx" ON "usage_events"("organizationId");
CREATE INDEX "tickets_organizationId_idx" ON "tickets"("organizationId");

-- Workspace slugs are unique per organization, not globally
DROP INDEX IF EXISTS "workspaces_slug_key";
CREATE UNIQUE INDEX "workspaces_organizationId_slug_key" ON "workspaces"("organizationId", "slug");

-- Connector / router names are unique per organization
DROP INDEX IF EXISTS "external_communication_connectors_type_key";
CREATE UNIQUE INDEX "external_communication_connectors_organizationId_type_key" ON "external_communication_connectors"("organizationId", "type");

DROP INDEX IF EXISTS "model_routers_name_key";
CREATE UNIQUE INDEX "model_routers_organizationId_name_key" ON "model_routers"("organizationId", "name");

DROP INDEX IF EXISTS "connected_file_sources_provider_account_email_key";
CREATE UNIQUE INDEX "connected_file_sources_organizationId_provider_account_email_key" ON "connected_file_sources"("organizationId", "provider", "account_email");
