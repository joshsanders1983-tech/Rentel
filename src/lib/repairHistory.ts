import { randomUUID } from "node:crypto";
import { prisma } from "./prisma.js";

type RepairHistoryAction = "DOWN" | "COMPLETE";

type RepairHistoryRow = {
  id: string;
  inventoryId: string;
  action: RepairHistoryAction;
  details: string | null;
  techName: string | null;
  repairHours: number | null;
  createdAt: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

async function run(sql: string, ...params: unknown[]): Promise<void> {
  await prisma.$executeRawUnsafe(sql, ...params);
}

async function queryRows<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  return prisma.$queryRawUnsafe<T[]>(sql, ...params);
}

function isDuplicateColumnError(error: unknown): boolean {
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";
  const lower = message.toLowerCase();
  return (
    lower.includes("duplicate column") ||
    (lower.includes("already exists") && lower.includes("column"))
  );
}

async function ensureRepairHistorySchema(): Promise<void> {
  await run(`
    CREATE TABLE IF NOT EXISTS "RepairHistoryEntry" (
      "id" TEXT PRIMARY KEY,
      "inventoryId" TEXT NOT NULL,
      "action" TEXT NOT NULL,
      "details" TEXT NULL,
      "techName" TEXT NULL,
      "repairHours" REAL NULL,
      "createdAt" TEXT NOT NULL,
      FOREIGN KEY ("inventoryId") REFERENCES "Inventory"("id") ON DELETE CASCADE
    )
  `);

  try {
    await run(`
      ALTER TABLE "RepairHistoryEntry"
      ADD COLUMN "repairHours" REAL
    `);
  } catch (error) {
    if (!isDuplicateColumnError(error)) {
      throw error;
    }
  }

  await run(`
    CREATE INDEX IF NOT EXISTS "RepairHistoryEntry_inventoryId_createdAt_idx"
    ON "RepairHistoryEntry" ("inventoryId", "createdAt")
  `);
}

export async function appendRepairHistoryEntry(input: {
  inventoryId: string;
  action: RepairHistoryAction;
  details?: string | null;
  techName?: string | null;
  repairHours?: number | null;
  createdAt?: Date;
}): Promise<void> {
  const inventoryId = String(input.inventoryId || "").trim();
  const action = String(input.action || "").trim().toUpperCase() as RepairHistoryAction;
  const allowedAction = action === "DOWN" || action === "COMPLETE";
  if (!inventoryId || !allowedAction) {
    return;
  }

  const details = input.details ? String(input.details).trim() : null;
  const techName = input.techName ? String(input.techName).trim() : null;
  const repairHours =
    typeof input.repairHours === "number" && Number.isFinite(input.repairHours)
      ? Number(input.repairHours)
      : null;
  const createdAt = input.createdAt ? input.createdAt.toISOString() : nowIso();

  await ensureRepairHistorySchema();
  await run(
    `
    INSERT INTO "RepairHistoryEntry" (
      "id",
      "inventoryId",
      "action",
      "details",
      "techName",
      "repairHours",
      "createdAt"
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `,
    randomUUID(),
    inventoryId,
    action,
    details || null,
    techName || null,
    repairHours,
    createdAt,
  );
}

export async function getRepairHistoryEntries(
  inventoryIdInput: string,
  limitInput = 100,
): Promise<RepairHistoryRow[]> {
  const inventoryId = String(inventoryIdInput || "").trim();
  const limit = Math.max(1, Math.min(500, Math.floor(Number(limitInput) || 100)));
  if (!inventoryId) return [];

  await ensureRepairHistorySchema();
  return queryRows<RepairHistoryRow>(
    `
    SELECT
      "id",
      "inventoryId",
      "action",
      "details",
      "techName",
      "repairHours",
      "createdAt"
    FROM "RepairHistoryEntry"
    WHERE "inventoryId" = $1
    ORDER BY "createdAt" DESC
    LIMIT $2
    `,
    inventoryId,
    limit,
  );
}
