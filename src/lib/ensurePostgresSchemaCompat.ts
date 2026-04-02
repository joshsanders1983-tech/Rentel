import { prisma } from "./prisma.js";

/**
 * Aligns the live Postgres schema with the Prisma model when a deploy skipped
 * `prisma migrate deploy` (same DDL as pending migrations).
 */
export async function ensurePostgresSchemaCompat(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "InspectionSubmission" ADD COLUMN IF NOT EXISTS "submittedByTechName" TEXT;`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "RepairHistoryEntry" ADD COLUMN IF NOT EXISTS "laborHours" DOUBLE PRECISION;`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "historyLocationName" TEXT;`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "historyLocationLatitude" DOUBLE PRECISION;`,
  );
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "historyLocationLongitude" DOUBLE PRECISION;`,
  );
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "PostRentalInspection" (
      "id" TEXT NOT NULL,
      "inspectionSubmissionId" TEXT NOT NULL,
      "inventoryId" TEXT NOT NULL,
      "unitNumberSnapshot" TEXT NOT NULL,
      "assetTypeSnapshot" TEXT,
      "assetDescriptionSnapshot" TEXT,
      "techNameSnapshot" TEXT,
      "submittedAt" TIMESTAMP(3) NOT NULL,
      "issueDescription" TEXT,
      "damageDescription" TEXT,
      "damagePhotosJson" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "flaggedItemsJson" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "PostRentalInspection_pkey" PRIMARY KEY ("id")
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "PostRentalInspection_inspectionSubmissionId_key"
    ON "PostRentalInspection"("inspectionSubmissionId");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "PostRentalInspection_submittedAt_idx"
    ON "PostRentalInspection"("submittedAt");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "PostRentalInspection_createdAt_idx"
    ON "PostRentalInspection"("createdAt");
  `);
}
