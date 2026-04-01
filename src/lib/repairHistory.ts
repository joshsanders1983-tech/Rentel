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
  laborHours: number | null;
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

  try {
    await run(`
      ALTER TABLE "RepairHistoryEntry"
      ADD COLUMN "laborHours" REAL
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

function collectErrorText(error: unknown): string {
  const parts: string[] = [];
  let e: unknown = error;
  for (let i = 0; i < 8 && e; i++) {
    if (e instanceof Error) {
      parts.push(e.message);
      const code = (e as { code?: unknown }).code;
      if (code !== undefined && code !== null) {
        parts.push(String(code));
      }
      const meta = (e as { meta?: unknown }).meta;
      if (meta !== undefined && meta !== null) {
        parts.push(typeof meta === "string" ? meta : JSON.stringify(meta));
      }
      e = e.cause;
    } else {
      parts.push(String(e));
      break;
    }
  }
  return parts.join(" ");
}

/** Prisma/pg often wrap the real message; column may be missing before migration. */
function isMissingLaborHoursColumnError(error: unknown): boolean {
  const lower = collectErrorText(error).toLowerCase();
  if (lower.includes("42703")) {
    return lower.includes("laborhours") || lower.includes("labor_hours");
  }
  if (
    (lower.includes("laborhours") || lower.includes("labor_hours")) &&
    (lower.includes("does not exist") ||
      lower.includes("undefined column") ||
      lower.includes("unknown column") ||
      lower.includes("no such column"))
  ) {
    return true;
  }
  return false;
}

async function insertRepairHistoryRowFull(input: {
  id: string;
  inventoryId: string;
  action: string;
  details: string | null;
  techName: string | null;
  repairHours: number | null;
  laborHours: number | null;
  createdAt: string;
}): Promise<void> {
  await run(
    `
    INSERT INTO "RepairHistoryEntry" (
      "id",
      "inventoryId",
      "action",
      "details",
      "techName",
      "repairHours",
      "laborHours",
      "createdAt"
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    input.id,
    input.inventoryId,
    input.action,
    input.details,
    input.techName,
    input.repairHours,
    input.laborHours,
    input.createdAt,
  );
}

async function insertRepairHistoryRowLegacy(input: {
  id: string;
  inventoryId: string;
  action: string;
  details: string | null;
  techName: string | null;
  repairHours: number | null;
  createdAt: string;
}): Promise<void> {
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
    input.id,
    input.inventoryId,
    input.action,
    input.details,
    input.techName,
    input.repairHours,
    input.createdAt,
  );
}

export async function appendRepairHistoryEntry(input: {
  inventoryId: string;
  action: RepairHistoryAction;
  details?: string | null;
  techName?: string | null;
  repairHours?: number | null;
  laborHours?: number | null;
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
  const laborHours =
    typeof input.laborHours === "number" && Number.isFinite(input.laborHours)
      ? Number(input.laborHours)
      : null;
  const createdAt = input.createdAt ? input.createdAt.toISOString() : nowIso();

  await ensureRepairHistorySchema();

  const id = randomUUID();
  const detailsForInsert =
    laborHours != null && Number.isFinite(laborHours)
      ? `${details ?? ""}${details ? "\n\n" : ""}Labor hrs: ${laborHours}`.trim()
      : details || null;

  try {
    await insertRepairHistoryRowFull({
      id,
      inventoryId,
      action,
      details: details || null,
      techName,
      repairHours,
      laborHours,
      createdAt,
    });
  } catch (err) {
    if (isMissingLaborHoursColumnError(err)) {
      console.warn("[repairHistory] laborHours INSERT not available; using legacy row.");
    } else {
      console.warn(
        "[repairHistory] full INSERT failed; retrying without laborHours column:",
        err instanceof Error ? err.message : err,
      );
    }
    await insertRepairHistoryRowLegacy({
      id,
      inventoryId,
      action,
      details: detailsForInsert,
      techName,
      repairHours,
      createdAt,
    });
  }
}

export async function getRepairHistoryEntries(
  inventoryIdInput: string,
  limitInput = 100,
): Promise<RepairHistoryRow[]> {
  const inventoryId = String(inventoryIdInput || "").trim();
  const limit = Math.max(1, Math.min(500, Math.floor(Number(limitInput) || 100)));
  if (!inventoryId) return [];

  await ensureRepairHistorySchema();
  const fullQuery = `
    SELECT
      "id",
      "inventoryId",
      "action",
      "details",
      "techName",
      "repairHours",
      "laborHours",
      "createdAt"
    FROM "RepairHistoryEntry"
    WHERE "inventoryId" = $1
    ORDER BY "createdAt" DESC
    LIMIT $2
  `;
  const legacyQuery = `
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
  `;
  try {
    return await queryRows<RepairHistoryRow>(fullQuery, inventoryId, limit);
  } catch (err) {
    if (isMissingLaborHoursColumnError(err)) {
      console.warn("[repairHistory] laborHours column missing; using legacy SELECT.");
    } else {
      console.warn(
        "[repairHistory] full SELECT failed; retrying without laborHours:",
        err instanceof Error ? err.message : err,
      );
    }
    const rows = await queryRows<
      Omit<RepairHistoryRow, "laborHours"> & { laborHours?: null }
    >(legacyQuery, inventoryId, limit);
    return rows.map((row) => ({ ...row, laborHours: null as number | null }));
  }
}
