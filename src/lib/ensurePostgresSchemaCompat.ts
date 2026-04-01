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
}
