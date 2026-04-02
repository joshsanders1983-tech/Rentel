import { prisma } from "./prisma.js";

type RepairHistoryAction = "DOWN" | "COMPLETE";

export type RepairHistoryRow = {
  id: string;
  inventoryId: string;
  action: RepairHistoryAction;
  details: string | null;
  techName: string | null;
  repairHours: number | null;
  laborHours: number | null;
  createdAt: string;
};

export function isInspectionDerivedRepairHistoryEntry(input: {
  action: string | null | undefined;
  details: string | null | undefined;
}): boolean {
  const action = String(input.action ?? "").trim().toUpperCase();
  const details = String(input.details ?? "").trim();
  if (!details) return false;

  if (
    action === "COMPLETE" &&
    /^inspection completed and unit returned to available\.?$/i.test(details)
  ) {
    return true;
  }

  if (
    action === "DOWN" &&
    (/(^|[|\n])\s*Damaged\s*:/i.test(details) ||
      /(^|[|\n])\s*Needs attention\s*:/i.test(details) ||
      /^inspection result moved this unit to down\.?$/i.test(details))
  ) {
    return true;
  }

  return false;
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
  const createdAt = input.createdAt ?? new Date();

  const detailsWithLaborFallback =
    laborHours != null && Number.isFinite(laborHours)
      ? `${details ?? ""}${details ? "\n\n" : ""}Labor hrs: ${laborHours}`.trim()
      : details || null;

  try {
    await prisma.repairHistoryEntry.create({
      data: {
        inventoryId,
        action,
        details,
        techName,
        repairHours,
        laborHours,
        createdAt,
      },
    });
  } catch (err) {
    if (!isMissingLaborHoursColumnError(err)) {
      throw err;
    }
    console.warn("[repairHistory] laborHours column missing; saving without labor column.");
    await prisma.repairHistoryEntry.create({
      data: {
        inventoryId,
        action,
        details: detailsWithLaborFallback,
        techName,
        repairHours,
        createdAt,
      },
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

  try {
    const rows = await prisma.repairHistoryEntry.findMany({
      where: { inventoryId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map((row) => ({
      // `laborHours` may not exist on older generated Prisma clients.
      // Keep runtime compatibility by reading it from the row dynamically.
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      laborHours: (row as { laborHours?: number | null }).laborHours ?? null,
      id: row.id,
      inventoryId: row.inventoryId,
      action: row.action as RepairHistoryAction,
      details: row.details ?? null,
      techName: row.techName ?? null,
      repairHours: row.repairHours ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
  } catch (err) {
    if (!isMissingLaborHoursColumnError(err)) {
      throw err;
    }
    console.warn("[repairHistory] laborHours column missing; selecting without labor column.");
    const rows = await prisma.$queryRawUnsafe<
      Array<{
        id: string;
        inventoryId: string;
        action: string;
        details: string | null;
        techName: string | null;
        repairHours: number | null;
        createdAt: Date;
      }>
    >(
      `SELECT "id", "inventoryId", "action", "details", "techName", "repairHours", "createdAt"
       FROM "RepairHistoryEntry" WHERE "inventoryId" = $1 ORDER BY "createdAt" DESC LIMIT $2`,
      inventoryId,
      limit,
    );
    return rows.map((row) => ({
      id: row.id,
      inventoryId: row.inventoryId,
      action: row.action as RepairHistoryAction,
      details: row.details ?? null,
      techName: row.techName ?? null,
      repairHours: row.repairHours ?? null,
      laborHours: null,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}
