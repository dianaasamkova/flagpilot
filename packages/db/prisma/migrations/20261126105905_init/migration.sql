-- CreateEnum
CREATE TYPE "Environment" AS ENUM ('dev', 'staging', 'production');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('pending', 'confirmed', 'discarded');

-- CreateTable
CREATE TABLE "Sandbox" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sandbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Flag" (
    "sandboxId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "tags" TEXT[],

    CONSTRAINT "Flag_pkey" PRIMARY KEY ("sandboxId","key")
);

-- CreateTable
CREATE TABLE "EnvConfig" (
    "sandboxId" UUID NOT NULL,
    "flagKey" TEXT NOT NULL,
    "env" "Environment" NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "targeting" JSONB NOT NULL,
    "rolloutPercent" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,

    CONSTRAINT "EnvConfig_pkey" PRIMARY KEY ("sandboxId","flagKey","env")
);

-- CreateTable
CREATE TABLE "FlagEvent" (
    "sandboxId" UUID NOT NULL,
    "id" TEXT NOT NULL,
    "flagKey" TEXT NOT NULL,
    "env" "Environment" NOT NULL,
    "actor" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "revision" INTEGER NOT NULL,

    CONSTRAINT "FlagEvent_pkey" PRIMARY KEY ("sandboxId","id")
);

-- CreateTable
CREATE TABLE "Proposal" (
    "sandboxId" UUID NOT NULL,
    "id" TEXT NOT NULL,
    "flagKey" TEXT NOT NULL,
    "env" "Environment" NOT NULL,
    "reason" TEXT NOT NULL,
    "baseRevision" INTEGER NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "ProposalStatus" NOT NULL,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("sandboxId","id")
);

-- CreateIndex
CREATE INDEX "Sandbox_createdAt_idx" ON "Sandbox"("createdAt");

-- CreateIndex
CREATE INDEX "FlagEvent_sandboxId_flagKey_at_idx" ON "FlagEvent"("sandboxId", "flagKey", "at" DESC);

-- AddForeignKey
ALTER TABLE "Flag" ADD CONSTRAINT "Flag_sandboxId_fkey" FOREIGN KEY ("sandboxId") REFERENCES "Sandbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnvConfig" ADD CONSTRAINT "EnvConfig_sandboxId_flagKey_fkey" FOREIGN KEY ("sandboxId", "flagKey") REFERENCES "Flag"("sandboxId", "key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlagEvent" ADD CONSTRAINT "FlagEvent_sandboxId_fkey" FOREIGN KEY ("sandboxId") REFERENCES "Sandbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_sandboxId_fkey" FOREIGN KEY ("sandboxId") REFERENCES "Sandbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written guards (FP-10). zod checks the same rules in the app; these keep the
-- database correct even if a bug or a manual query skips the app.

-- Rollout is a whole percentage, revisions never go below 0
ALTER TABLE "EnvConfig" ADD CONSTRAINT "EnvConfig_rolloutPercent_check" CHECK ("rolloutPercent" BETWEEN 0 AND 100);
ALTER TABLE "EnvConfig" ADD CONSTRAINT "EnvConfig_revision_check" CHECK ("revision" >= 0);
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_baseRevision_check" CHECK ("baseRevision" >= 0);
ALTER TABLE "FlagEvent" ADD CONSTRAINT "FlagEvent_revision_check" CHECK ("revision" >= 1);

-- The history is append-only: an UPDATE on FlagEvent is an error. DELETE stays allowed,
-- because removing a whole sandbox (daily cleanup, FP-34) removes its events too.
CREATE FUNCTION flag_event_is_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'FlagEvent rows are append-only and cannot be updated';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FlagEvent_no_update"
  BEFORE UPDATE ON "FlagEvent"
  FOR EACH ROW EXECUTE FUNCTION flag_event_is_append_only();
