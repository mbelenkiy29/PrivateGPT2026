-- DropIndex
DROP INDEX "connected_file_sources_provider_key";

-- AlterTable
ALTER TABLE "embed_configs" ADD COLUMN "ai_disclosure" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "embed_configs" ADD COLUMN "show_handoff" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "embed_configs" ADD COLUMN "handoff_email" TEXT;
ALTER TABLE "embed_configs" ADD COLUMN "lead_capture" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "embed_configs" ADD COLUMN "business_hours_json" TEXT;
ALTER TABLE "embed_configs" ADD COLUMN "grounded_only" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "knowledge_sources" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "provider" TEXT NOT NULL,
    "workspaceId" INTEGER NOT NULL,
    "display_name" TEXT NOT NULL,
    "remote_id" TEXT,
    "encrypted_config" TEXT,
    "sync_cursor" TEXT,
    "watch_enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_synced_at" DATETIME,
    "last_error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "knowledge_sources_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "knowledge_source_sync_runs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sourceId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "result" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "knowledge_source_sync_runs_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "knowledge_sources" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "usage_events" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "workspaceId" INTEGER,
    "userId" INTEGER,
    "provider" TEXT,
    "model" TEXT,
    "local" BOOLEAN NOT NULL DEFAULT false,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" REAL NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "embed_leads" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "embed_id" INTEGER NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "last_question" TEXT,
    "session_id" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "embed_leads_embed_id_fkey" FOREIGN KEY ("embed_id") REFERENCES "embed_configs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "embed_handoffs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "embed_id" INTEGER NOT NULL,
    "session_id" TEXT NOT NULL,
    "email_to" TEXT,
    "transcript" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "embed_handoffs_embed_id_fkey" FOREIGN KEY ("embed_id") REFERENCES "embed_configs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "embed_unanswered" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "embed_id" INTEGER NOT NULL,
    "session_id" TEXT,
    "question" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "embed_unanswered_embed_id_fkey" FOREIGN KEY ("embed_id") REFERENCES "embed_configs" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "channel_workspace_bindings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "connector_type" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "workspaceId" INTEGER NOT NULL,
    "threadSlug" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "channel_workspace_bindings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "connected_file_sources_provider_account_email_key" ON "connected_file_sources"("provider", "account_email");

-- CreateIndex
CREATE INDEX "knowledge_sources_workspaceId_idx" ON "knowledge_sources"("workspaceId");

-- CreateIndex
CREATE INDEX "knowledge_sources_provider_idx" ON "knowledge_sources"("provider");

-- CreateIndex
CREATE INDEX "usage_events_workspaceId_createdAt_idx" ON "usage_events"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "usage_events_userId_idx" ON "usage_events"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_workspace_bindings_connector_type_external_id_key" ON "channel_workspace_bindings"("connector_type", "external_id");
