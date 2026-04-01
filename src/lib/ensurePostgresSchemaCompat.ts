import { prisma } from "./prisma.js";

/**
 * Aligns the live Postgres schema with the Prisma model when a deploy skipped
 * `prisma migrate deploy` (same DDL as migration 20260401140000_inspection_submission_tech_name).
 */
export async function ensurePostgresSchemaCompat(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "InspectionSubmission" ADD COLUMN IF NOT EXISTS "submittedByTechName" TEXT;`,
  );
}
