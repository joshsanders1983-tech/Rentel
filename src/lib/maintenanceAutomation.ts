import { randomUUID } from "node:crypto";
import { prisma } from "./prisma.js";
import { normalizeStatus } from "./statusFormat.js";

type MaintenanceTriggerType = "HOURS" | "RENTAL_COUNT";
type MaintenanceScopeType = "ALL_UNITS" | "ASSET_TYPES" | "SPECIFIC_UNITS";
type MaintenanceTaskStatus = "DUE" | "IN_PROGRESS" | "COMPLETED";

type InventoryRow = {
  id: string;
  assetId: string;
  unitNumber: string;
  hours: number | null;
  status: string;
  inspectionRequired: number;
  downReason: string | null;
};

type RuleRow = {
  id: string;
  name: string;
  serviceLabel: string;
  triggerType: MaintenanceTriggerType;
  intervalValue: number;
  scopeType: MaintenanceScopeType;
  inspectionFormId: string | null;
  active: number;
  createdAt: string;
  updatedAt: string;
};

type ScopeAssetRow = {
  ruleId: string;
  assetId: string;
};

type ScopeUnitRow = {
  ruleId: string;
  inventoryId: string;
};

type CounterRow = {
  inventoryId: string;
  rentalCycleCount: number;
};

type OpenTaskReasonRow = {
  inventoryId: string;
  reason: string;
};

type TaskRow = {
  id: string;
  inventoryId: string;
  inspectionFormId: string | null;
  createdAt: string;
  status: MaintenanceTaskStatus;
};

const STATUS_AVAILABLE = "Available";
const STATUS_DOWN = "Down";
const STATUS_ON_RENT = "On Rent";
const STATUS_RESERVED = "Reserved";
const SERVICE_REASON_PREFIX = "Service Due:";

function nowIso(): string {
  return new Date().toISOString();
}

function toIdList(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim())
        .filter((value) => Boolean(value)),
    ),
  );
}

export function isServiceDueReason(value: unknown): boolean {
  const reason = String(value ?? "").trim();
  return reason.startsWith(SERVICE_REASON_PREFIX);
}

function parseNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function queryRows<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  return prisma.$queryRawUnsafe<T[]>(sql, ...params);
}

async function run(sql: string, ...params: unknown[]): Promise<void> {
  await prisma.$executeRawUnsafe(sql, ...params);
}

/** PostgreSQL positional parameters for `$queryRawUnsafe` / `$executeRawUnsafe`. */
export function pgPlaceholders(count: number): string {
  if (count <= 0) return "";
  return Array.from({ length: count }, (_, i) => `$${i + 1}`).join(", ");
}

export async function ensureMaintenanceAutomationSchema(): Promise<void> {
  await run(`
    CREATE TABLE IF NOT EXISTS "InventoryMaintenanceCounter" (
      "inventoryId" TEXT PRIMARY KEY,
      "rentalCycleCount" INTEGER NOT NULL DEFAULT 0,
      "updatedAt" TEXT NOT NULL,
      FOREIGN KEY ("inventoryId") REFERENCES "Inventory"("id") ON DELETE CASCADE
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS "MaintenanceRule" (
      "id" TEXT PRIMARY KEY,
      "name" TEXT NOT NULL,
      "serviceLabel" TEXT NOT NULL,
      "triggerType" TEXT NOT NULL,
      "intervalValue" INTEGER NOT NULL,
      "scopeType" TEXT NOT NULL,
      "inspectionFormId" TEXT NULL,
      "active" INTEGER NOT NULL DEFAULT 1,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL,
      FOREIGN KEY ("inspectionFormId") REFERENCES "InspectionForm"("id") ON DELETE SET NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS "MaintenanceRuleAssetScope" (
      "id" TEXT PRIMARY KEY,
      "ruleId" TEXT NOT NULL,
      "assetId" TEXT NOT NULL,
      FOREIGN KEY ("ruleId") REFERENCES "MaintenanceRule"("id") ON DELETE CASCADE,
      FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE,
      UNIQUE ("ruleId", "assetId")
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS "MaintenanceRuleUnitScope" (
      "id" TEXT PRIMARY KEY,
      "ruleId" TEXT NOT NULL,
      "inventoryId" TEXT NOT NULL,
      FOREIGN KEY ("ruleId") REFERENCES "MaintenanceRule"("id") ON DELETE CASCADE,
      FOREIGN KEY ("inventoryId") REFERENCES "Inventory"("id") ON DELETE CASCADE,
      UNIQUE ("ruleId", "inventoryId")
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS "MaintenanceTask" (
      "id" TEXT PRIMARY KEY,
      "ruleId" TEXT NOT NULL,
      "inventoryId" TEXT NOT NULL,
      "triggerType" TEXT NOT NULL,
      "dueValue" INTEGER NOT NULL,
      "currentValue" INTEGER NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'DUE',
      "reason" TEXT NOT NULL,
      "inspectionFormId" TEXT NULL,
      "assignedTechName" TEXT NULL,
      "createdAt" TEXT NOT NULL,
      "updatedAt" TEXT NOT NULL,
      "completedAt" TEXT NULL,
      "completionInspectionSubmissionId" TEXT NULL,
      FOREIGN KEY ("ruleId") REFERENCES "MaintenanceRule"("id") ON DELETE CASCADE,
      FOREIGN KEY ("inventoryId") REFERENCES "Inventory"("id") ON DELETE CASCADE,
      FOREIGN KEY ("inspectionFormId") REFERENCES "InspectionForm"("id") ON DELETE SET NULL,
      FOREIGN KEY ("completionInspectionSubmissionId") REFERENCES "InspectionSubmission"("id") ON DELETE SET NULL,
      UNIQUE ("ruleId", "inventoryId", "triggerType", "dueValue")
    )
  `);
}

async function ensureCounterRows(inventoryIds: string[]): Promise<void> {
  const ids = toIdList(inventoryIds);
  if (ids.length === 0) return;

  const now = nowIso();
  for (const inventoryId of ids) {
    await run(
      `
      INSERT INTO "InventoryMaintenanceCounter"
      ("inventoryId", "rentalCycleCount", "updatedAt")
      VALUES ($1, 0, $2)
      ON CONFLICT ("inventoryId") DO NOTHING
      `,
      inventoryId,
      now,
    );
  }
}

async function getInventoryRows(inventoryIds: string[]): Promise<InventoryRow[]> {
  const ids = toIdList(inventoryIds);
  if (ids.length === 0) return [];

  return queryRows<InventoryRow>(
    `
    SELECT
      "id",
      "assetId",
      "unitNumber",
      "hours",
      "status",
      "inspectionRequired",
      "downReason"
    FROM "Inventory"
    WHERE "id" IN (${pgPlaceholders(ids.length)})
    `,
    ...ids,
  );
}

async function getAllInventoryIds(): Promise<string[]> {
  const rows = await queryRows<{ id: string }>(`SELECT "id" FROM "Inventory"`);
  return rows.map((row) => row.id);
}

function ruleAppliesToInventory(
  rule: RuleRow,
  inventory: InventoryRow,
  ruleAssetScopes: Map<string, Set<string>>,
  ruleUnitScopes: Map<string, Set<string>>,
): boolean {
  if (rule.scopeType === "ALL_UNITS") return true;
  if (rule.scopeType === "ASSET_TYPES") {
    return ruleAssetScopes.get(rule.id)?.has(inventory.assetId) === true;
  }
  if (rule.scopeType === "SPECIFIC_UNITS") {
    return ruleUnitScopes.get(rule.id)?.has(inventory.id) === true;
  }
  return false;
}

function metricForRule(
  rule: RuleRow,
  inventory: InventoryRow,
  rentalCounterByInventoryId: Map<string, number>,
): number {
  if (rule.triggerType === "HOURS") {
    return Math.floor(parseNumber(inventory.hours));
  }
  return Math.floor(rentalCounterByInventoryId.get(inventory.id) ?? 0);
}

async function applyInventoryServiceState(inventoryIds: string[]): Promise<void> {
  const ids = toIdList(inventoryIds);
  if (ids.length === 0) return;

  const inventories = await getInventoryRows(ids);
  if (inventories.length === 0) return;

  const openReasons = await queryRows<OpenTaskReasonRow>(
    `
    SELECT "inventoryId", "reason"
    FROM "MaintenanceTask"
    WHERE "inventoryId" IN (${pgPlaceholders(ids.length)})
      AND "status" != 'COMPLETED'
    ORDER BY "createdAt" ASC
    `,
    ...ids,
  );

  const reasonsByInventory = new Map<string, string[]>();
  for (const row of openReasons) {
    const prev = reasonsByInventory.get(row.inventoryId) || [];
    if (!prev.includes(row.reason)) prev.push(row.reason);
    reasonsByInventory.set(row.inventoryId, prev);
  }

  for (const inventory of inventories) {
    const reasons = reasonsByInventory.get(inventory.id) || [];
    const hasOpenTasks = reasons.length > 0;
    const currentStatus = normalizeStatus(inventory.status);
    const nextReason = hasOpenTasks ? reasons.join(" | ") : null;
    const shouldProtectLiveRental =
      currentStatus === STATUS_ON_RENT || currentStatus === STATUS_RESERVED;

    const updates: Record<string, unknown> = {};

    if (hasOpenTasks) {
      if (!shouldProtectLiveRental && currentStatus !== STATUS_DOWN) {
        updates.status = STATUS_DOWN;
      }
      if (!shouldProtectLiveRental) {
        updates.inspectionRequired = true;
      }
      if (inventory.downReason !== nextReason) {
        updates.downReason = nextReason;
      }
    } else {
      if (isServiceDueReason(inventory.downReason) && inventory.downReason !== null) {
        updates.downReason = null;
      }
      if (
        currentStatus === STATUS_DOWN &&
        isServiceDueReason(inventory.downReason) &&
        Number(inventory.inspectionRequired) === 0
      ) {
        updates.status = STATUS_AVAILABLE;
      }
    }

    if (Object.keys(updates).length === 0) continue;

    const columns = Object.keys(updates);
    const assignments = columns
      .map((column, idx) => `"${column}" = $${idx + 1}`)
      .join(", ");
    const values = columns.map((column) => updates[column]);
    await run(
      `UPDATE "Inventory" SET ${assignments} WHERE "id" = $${columns.length + 1}`,
      ...values,
      inventory.id,
    );
  }
}

export async function evaluateMaintenanceRulesForUnits(
  inventoryIdsInput: string[],
): Promise<void> {
  await ensureMaintenanceAutomationSchema();

  const inventoryIds = toIdList(inventoryIdsInput);
  if (inventoryIds.length === 0) return;

  await ensureCounterRows(inventoryIds);
  const inventories = await getInventoryRows(inventoryIds);
  if (inventories.length === 0) return;

  const activeRules = await queryRows<RuleRow>(
    `
    SELECT
      "id",
      "name",
      "serviceLabel",
      "triggerType",
      "intervalValue",
      "scopeType",
      "inspectionFormId",
      "active",
      "createdAt",
      "updatedAt"
    FROM "MaintenanceRule"
    WHERE "active" = 1
    `,
  );

  if (activeRules.length === 0) {
    await applyInventoryServiceState(inventoryIds);
    return;
  }

  const ruleIds = activeRules.map((rule) => rule.id);
  const assetScopes = await queryRows<ScopeAssetRow>(
    `
    SELECT "ruleId", "assetId"
    FROM "MaintenanceRuleAssetScope"
    WHERE "ruleId" IN (${pgPlaceholders(ruleIds.length)})
    `,
    ...ruleIds,
  );
  const unitScopes = await queryRows<ScopeUnitRow>(
    `
    SELECT "ruleId", "inventoryId"
    FROM "MaintenanceRuleUnitScope"
    WHERE "ruleId" IN (${pgPlaceholders(ruleIds.length)})
    `,
    ...ruleIds,
  );

  const counters = await queryRows<CounterRow>(
    `
    SELECT "inventoryId", "rentalCycleCount"
    FROM "InventoryMaintenanceCounter"
    WHERE "inventoryId" IN (${pgPlaceholders(inventoryIds.length)})
    `,
    ...inventoryIds,
  );
  const rentalCounterByInventoryId = new Map<string, number>();
  for (const counter of counters) {
    rentalCounterByInventoryId.set(
      counter.inventoryId,
      Math.floor(parseNumber(counter.rentalCycleCount)),
    );
  }

  const ruleAssetScopes = new Map<string, Set<string>>();
  for (const scope of assetScopes) {
    if (!ruleAssetScopes.has(scope.ruleId)) {
      ruleAssetScopes.set(scope.ruleId, new Set<string>());
    }
    ruleAssetScopes.get(scope.ruleId)?.add(scope.assetId);
  }

  const ruleUnitScopes = new Map<string, Set<string>>();
  for (const scope of unitScopes) {
    if (!ruleUnitScopes.has(scope.ruleId)) {
      ruleUnitScopes.set(scope.ruleId, new Set<string>());
    }
    ruleUnitScopes.get(scope.ruleId)?.add(scope.inventoryId);
  }

  for (const inventory of inventories) {
    for (const rule of activeRules) {
      if (!ruleAppliesToInventory(rule, inventory, ruleAssetScopes, ruleUnitScopes)) {
        continue;
      }
      const intervalValue = Math.floor(parseNumber(rule.intervalValue));
      if (intervalValue < 1) continue;

      const metric = metricForRule(rule, inventory, rentalCounterByInventoryId);
      const dueCount = Math.floor(metric / intervalValue);
      if (dueCount < 1) continue;

      const reason = `${SERVICE_REASON_PREFIX} ${rule.serviceLabel || rule.name}`;
      const createdAt = nowIso();
      for (let idx = 1; idx <= dueCount; idx += 1) {
        const dueValue = idx * intervalValue;
        await run(
          `
          INSERT INTO "MaintenanceTask" (
            "id",
            "ruleId",
            "inventoryId",
            "triggerType",
            "dueValue",
            "currentValue",
            "status",
            "reason",
            "inspectionFormId",
            "assignedTechName",
            "createdAt",
            "updatedAt"
          ) VALUES ($1, $2, $3, $4, $5, $6, 'DUE', $7, $8, NULL, $9, $10)
          ON CONFLICT ("ruleId", "inventoryId", "triggerType", "dueValue") DO NOTHING
          `,
          randomUUID(),
          rule.id,
          inventory.id,
          rule.triggerType,
          dueValue,
          metric,
          reason,
          rule.inspectionFormId,
          createdAt,
          createdAt,
        );
      }
    }
  }

  await applyInventoryServiceState(inventoryIds);
}

export async function evaluateMaintenanceRulesForAllUnits(): Promise<void> {
  await ensureMaintenanceAutomationSchema();
  const inventoryIds = await getAllInventoryIds();
  await evaluateMaintenanceRulesForUnits(inventoryIds);
}

export async function incrementRentalCycleCounters(
  inventoryIdsInput: string[],
): Promise<void> {
  await ensureMaintenanceAutomationSchema();
  const inventoryIds = toIdList(inventoryIdsInput);
  if (inventoryIds.length === 0) return;

  await ensureCounterRows(inventoryIds);
  const updatedAt = nowIso();
  for (const inventoryId of inventoryIds) {
    await run(
      `
      UPDATE "InventoryMaintenanceCounter"
      SET "rentalCycleCount" = "rentalCycleCount" + 1,
          "updatedAt" = $1
      WHERE "inventoryId" = $2
      `,
      updatedAt,
      inventoryId,
    );
  }

  await evaluateMaintenanceRulesForUnits(inventoryIds);
}

export async function completeOpenMaintenanceTasksForInspection(
  inventoryId: string,
  inspectionSubmissionId: string,
  inspectionFormId: string,
  submittedAtIso: string,
): Promise<void> {
  await ensureMaintenanceAutomationSchema();
  const normalizedInventoryId = String(inventoryId || "").trim();
  if (!normalizedInventoryId) return;

  const tasks = await queryRows<TaskRow>(
    `
    SELECT "id", "inventoryId", "inspectionFormId", "createdAt", "status"
    FROM "MaintenanceTask"
    WHERE "inventoryId" = $1
      AND "status" != 'COMPLETED'
      AND "createdAt" <= $2
    `,
    normalizedInventoryId,
    submittedAtIso,
  );

  for (const task of tasks) {
    if (task.inspectionFormId && task.inspectionFormId !== inspectionFormId) {
      continue;
    }
    await run(
      `
      UPDATE "MaintenanceTask"
      SET "status" = 'COMPLETED',
          "completedAt" = $1,
          "completionInspectionSubmissionId" = $2,
          "updatedAt" = $3
      WHERE "id" = $4
      `,
      submittedAtIso,
      inspectionSubmissionId,
      submittedAtIso,
      task.id,
    );
  }

  await applyInventoryServiceState([normalizedInventoryId]);
}

export async function completeOpenMaintenanceTasksForInventory(
  inventoryId: string,
  completedAtInput?: string,
): Promise<void> {
  await ensureMaintenanceAutomationSchema();
  const normalizedInventoryId = String(inventoryId || "").trim();
  if (!normalizedInventoryId) return;

  const completedAt = completedAtInput || nowIso();
  await run(
    `
    UPDATE "MaintenanceTask"
    SET "status" = 'COMPLETED',
        "completedAt" = $1,
        "updatedAt" = $2
    WHERE "inventoryId" = $3
      AND "status" != 'COMPLETED'
    `,
    completedAt,
    completedAt,
    normalizedInventoryId,
  );

  await applyInventoryServiceState([normalizedInventoryId]);
}

export async function setTaskAssignedTechName(
  taskId: string,
  techName: string | null,
): Promise<void> {
  await ensureMaintenanceAutomationSchema();
  const normalizedTaskId = String(taskId || "").trim();
  if (!normalizedTaskId) return;
  const normalizedTechName = techName ? String(techName).trim() : null;
  await run(
    `
    UPDATE "MaintenanceTask"
    SET "assignedTechName" = $1,
        "updatedAt" = $2
    WHERE "id" = $3
    `,
    normalizedTechName,
    nowIso(),
    normalizedTaskId,
  );
}

export async function refreshInventoryMaintenanceStateForUnits(
  inventoryIdsInput: string[],
): Promise<void> {
  await ensureMaintenanceAutomationSchema();
  const ids = toIdList(inventoryIdsInput);
  if (ids.length === 0) return;
  await applyInventoryServiceState(ids);
}
