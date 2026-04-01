import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { isAdminAuthenticated, requireAdmin } from "../lib/adminAuth.js";
import { isTechAuthenticated } from "../lib/techAuth.js";
import {
  ensureMaintenanceAutomationSchema,
  evaluateMaintenanceRulesForAllUnits,
  evaluateMaintenanceRulesForUnits,
  pgPlaceholders,
  refreshInventoryMaintenanceStateForUnits,
  setTaskAssignedTechName,
} from "../lib/maintenanceAutomation.js";
import { prisma } from "../lib/prisma.js";

export const apiMaintenanceAutomationRouter = Router();

function requireTechOrAdmin(req: Request, res: Response, next: NextFunction): void {
  if (isTechAuthenticated(req) || isAdminAuthenticated(req)) {
    next();
    return;
  }
  res.status(403).json({ error: "Tech or admin authentication required." });
}

type TriggerType = "HOURS" | "RENTAL_COUNT";
type ScopeType = "ALL_UNITS" | "ASSET_TYPES" | "SPECIFIC_UNITS";
type TaskStatus = "DUE" | "IN_PROGRESS" | "COMPLETED";

type RuleRow = {
  id: string;
  name: string;
  serviceLabel: string;
  triggerType: TriggerType;
  intervalValue: number;
  scopeType: ScopeType;
  inspectionFormId: string | null;
  active: number;
  createdAt: string;
  updatedAt: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function toIdList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value) => Boolean(value)),
    ),
  );
}

function parseTriggerType(value: unknown): TriggerType | null {
  const text = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (text === "HOURS" || text === "RENTAL_COUNT") {
    return text;
  }
  return null;
}

function parseScopeType(value: unknown): ScopeType | null {
  const text = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (text === "ALL_UNITS" || text === "ASSET_TYPES" || text === "SPECIFIC_UNITS") {
    return text;
  }
  return null;
}

function parseInterval(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.floor(parsed);
}

async function queryRows<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  return prisma.$queryRawUnsafe<T[]>(sql, ...params);
}

async function run(sql: string, ...params: unknown[]): Promise<void> {
  await prisma.$executeRawUnsafe(sql, ...params);
}

async function listRules() {
  await ensureMaintenanceAutomationSchema();
  const rules = await queryRows<RuleRow>(
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
    ORDER BY "createdAt" ASC
    `,
  );

  const ruleIds = rules.map((rule) => rule.id);
  if (ruleIds.length === 0) return [];

  const assetScopes = await queryRows<{ ruleId: string; assetId: string }>(
    `
    SELECT "ruleId", "assetId"
    FROM "MaintenanceRuleAssetScope"
    WHERE "ruleId" IN (${pgPlaceholders(ruleIds.length)})
    `,
    ...ruleIds,
  );
  const unitScopes = await queryRows<{ ruleId: string; inventoryId: string }>(
    `
    SELECT "ruleId", "inventoryId"
    FROM "MaintenanceRuleUnitScope"
    WHERE "ruleId" IN (${pgPlaceholders(ruleIds.length)})
    `,
    ...ruleIds,
  );
  const formRows = await queryRows<{ id: string; name: string }>(
    `
    SELECT "id", "name"
    FROM "InspectionForm"
    `,
  );
  const formNameById = new Map<string, string>();
  for (const form of formRows) formNameById.set(form.id, form.name);

  const assetIdsByRule = new Map<string, string[]>();
  for (const scope of assetScopes) {
    const prev = assetIdsByRule.get(scope.ruleId) || [];
    prev.push(scope.assetId);
    assetIdsByRule.set(scope.ruleId, prev);
  }

  const unitIdsByRule = new Map<string, string[]>();
  for (const scope of unitScopes) {
    const prev = unitIdsByRule.get(scope.ruleId) || [];
    prev.push(scope.inventoryId);
    unitIdsByRule.set(scope.ruleId, prev);
  }

  return rules.map((rule) => ({
    ...rule,
    active: rule.active === 1,
    assetIds: assetIdsByRule.get(rule.id) || [],
    unitIds: unitIdsByRule.get(rule.id) || [],
    inspectionFormName: rule.inspectionFormId
      ? formNameById.get(rule.inspectionFormId) || null
      : null,
  }));
}

async function inventoryIdsForRuleScope(
  scopeType: ScopeType,
  assetIds: string[],
  unitIds: string[],
): Promise<string[]> {
  if (scopeType === "ALL_UNITS") {
    const rows = await queryRows<{ id: string }>(`SELECT "id" FROM "Inventory"`);
    return rows.map((row) => row.id);
  }
  if (scopeType === "ASSET_TYPES") {
    if (assetIds.length === 0) return [];
    const rows = await queryRows<{ id: string }>(
      `
      SELECT "id"
      FROM "Inventory"
      WHERE "assetId" IN (${pgPlaceholders(assetIds.length)})
      `,
      ...assetIds,
    );
    return rows.map((row) => row.id);
  }
  return unitIds;
}

async function validateAssetIds(assetIds: string[]): Promise<boolean> {
  if (assetIds.length === 0) return true;
  const rows = await queryRows<{ id: string }>(
    `
    SELECT "id"
    FROM "Asset"
    WHERE "id" IN (${pgPlaceholders(assetIds.length)}) AND "active" = true
    `,
    ...assetIds,
  );
  return rows.length === assetIds.length;
}

async function validateUnitIds(unitIds: string[]): Promise<boolean> {
  if (unitIds.length === 0) return true;
  const rows = await queryRows<{ id: string }>(
    `
    SELECT "id"
    FROM "Inventory"
    WHERE "id" IN (${pgPlaceholders(unitIds.length)})
    `,
    ...unitIds,
  );
  return rows.length === unitIds.length;
}

async function validateInspectionFormId(formId: string | null): Promise<boolean> {
  if (!formId) return true;
  const rows = await queryRows<{ id: string }>(
    `SELECT "id" FROM "InspectionForm" WHERE "id" = $1`,
    formId,
  );
  return rows.length === 1;
}

apiMaintenanceAutomationRouter.get("/rules", async (_req, res) => {
  const rules = await listRules();
  res.json(rules);
});

apiMaintenanceAutomationRouter.post("/rules", requireAdmin, async (req, res) => {
  await ensureMaintenanceAutomationSchema();
  const body = req.body as Record<string, unknown>;

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const serviceLabel =
    typeof body.serviceLabel === "string" ? body.serviceLabel.trim() : name;
  const triggerType = parseTriggerType(body.triggerType);
  const intervalValue = parseInterval(body.intervalValue);
  const scopeType = parseScopeType(body.scopeType);
  const inspectionFormIdRaw =
    typeof body.inspectionFormId === "string" ? body.inspectionFormId.trim() : "";
  const inspectionFormId = inspectionFormIdRaw || null;
  const active = typeof body.active === "boolean" ? body.active : true;
  const assetIds = toIdList(body.assetIds);
  const unitIds = toIdList(body.unitIds);

  if (!name || !serviceLabel) {
    res.status(400).json({ error: "Rule name and service label are required." });
    return;
  }
  if (!triggerType) {
    res.status(400).json({ error: "Trigger type must be HOURS or RENTAL_COUNT." });
    return;
  }
  if (!scopeType) {
    res.status(400).json({ error: "Scope type is invalid." });
    return;
  }
  if (intervalValue < 1) {
    res.status(400).json({ error: "Interval must be at least 1." });
    return;
  }
  if (scopeType === "ASSET_TYPES" && assetIds.length === 0) {
    res.status(400).json({ error: "Select at least one asset type for this scope." });
    return;
  }
  if (scopeType === "SPECIFIC_UNITS" && unitIds.length === 0) {
    res.status(400).json({ error: "Select at least one unit for this scope." });
    return;
  }
  if (!(await validateAssetIds(assetIds))) {
    res.status(400).json({ error: "One or more selected asset types are invalid." });
    return;
  }
  if (!(await validateUnitIds(unitIds))) {
    res.status(400).json({ error: "One or more selected units are invalid." });
    return;
  }
  if (!(await validateInspectionFormId(inspectionFormId))) {
    res.status(400).json({ error: "Selected inspection form was not found." });
    return;
  }

  const ruleId = randomUUID();
  const now = nowIso();
  await run(
    `
    INSERT INTO "MaintenanceRule" (
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
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `,
    ruleId,
    name,
    serviceLabel,
    triggerType,
    intervalValue,
    scopeType,
    inspectionFormId,
    active ? 1 : 0,
    now,
    now,
  );

  for (const assetId of assetIds) {
    await run(
      `
      INSERT INTO "MaintenanceRuleAssetScope" ("id", "ruleId", "assetId")
      VALUES ($1, $2, $3)
      ON CONFLICT ("ruleId", "assetId") DO NOTHING
      `,
      randomUUID(),
      ruleId,
      assetId,
    );
  }
  for (const inventoryId of unitIds) {
    await run(
      `
      INSERT INTO "MaintenanceRuleUnitScope" ("id", "ruleId", "inventoryId")
      VALUES ($1, $2, $3)
      ON CONFLICT ("ruleId", "inventoryId") DO NOTHING
      `,
      randomUUID(),
      ruleId,
      inventoryId,
    );
  }

  const affectedInventoryIds = await inventoryIdsForRuleScope(scopeType, assetIds, unitIds);
  await evaluateMaintenanceRulesForUnits(affectedInventoryIds);

  const rules = await listRules();
  const created = rules.find((rule) => rule.id === ruleId);
  res.status(201).json(created || null);
});

apiMaintenanceAutomationRouter.patch("/rules/:id", requireAdmin, async (req, res) => {
  await ensureMaintenanceAutomationSchema();
  const ruleId = typeof req.params.id === "string" ? req.params.id.trim() : "";
  if (!ruleId) {
    res.status(400).json({ error: "Invalid rule id." });
    return;
  }

  const existingRows = await queryRows<RuleRow>(
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
    WHERE "id" = $1
    `,
    ruleId,
  );
  const existing = existingRows[0];
  if (!existing) {
    res.status(404).json({ error: "Maintenance rule not found." });
    return;
  }

  const currentAssetRows = await queryRows<{ assetId: string }>(
    `SELECT "assetId" FROM "MaintenanceRuleAssetScope" WHERE "ruleId" = $1`,
    ruleId,
  );
  const currentUnitRows = await queryRows<{ inventoryId: string }>(
    `SELECT "inventoryId" FROM "MaintenanceRuleUnitScope" WHERE "ruleId" = $1`,
    ruleId,
  );
  const currentAssetIds = currentAssetRows.map((row) => row.assetId);
  const currentUnitIds = currentUnitRows.map((row) => row.inventoryId);

  const body = req.body as Record<string, unknown>;
  const nextName =
    typeof body.name === "string" ? body.name.trim() : existing.name;
  const nextServiceLabel =
    typeof body.serviceLabel === "string"
      ? body.serviceLabel.trim()
      : existing.serviceLabel;
  const nextTriggerType =
    parseTriggerType(body.triggerType) || existing.triggerType;
  const intervalCandidate = Object.prototype.hasOwnProperty.call(body, "intervalValue")
    ? parseInterval(body.intervalValue)
    : existing.intervalValue;
  const nextScopeType = parseScopeType(body.scopeType) || existing.scopeType;
  const nextInspectionFormIdRaw =
    typeof body.inspectionFormId === "string"
      ? body.inspectionFormId.trim()
      : existing.inspectionFormId || "";
  const nextInspectionFormId = nextInspectionFormIdRaw || null;
  const nextActive =
    typeof body.active === "boolean" ? body.active : existing.active === 1;
  const nextAssetIds = Object.prototype.hasOwnProperty.call(body, "assetIds")
    ? toIdList(body.assetIds)
    : currentAssetIds;
  const nextUnitIds = Object.prototype.hasOwnProperty.call(body, "unitIds")
    ? toIdList(body.unitIds)
    : currentUnitIds;

  if (!nextName || !nextServiceLabel) {
    res.status(400).json({ error: "Rule name and service label are required." });
    return;
  }
  if (intervalCandidate < 1) {
    res.status(400).json({ error: "Interval must be at least 1." });
    return;
  }
  if (nextScopeType === "ASSET_TYPES" && nextAssetIds.length === 0) {
    res.status(400).json({ error: "Select at least one asset type for this scope." });
    return;
  }
  if (nextScopeType === "SPECIFIC_UNITS" && nextUnitIds.length === 0) {
    res.status(400).json({ error: "Select at least one unit for this scope." });
    return;
  }
  if (!(await validateAssetIds(nextAssetIds))) {
    res.status(400).json({ error: "One or more selected asset types are invalid." });
    return;
  }
  if (!(await validateUnitIds(nextUnitIds))) {
    res.status(400).json({ error: "One or more selected units are invalid." });
    return;
  }
  if (!(await validateInspectionFormId(nextInspectionFormId))) {
    res.status(400).json({ error: "Selected inspection form was not found." });
    return;
  }

  await run(
    `
    UPDATE "MaintenanceRule"
    SET
      "name" = $1,
      "serviceLabel" = $2,
      "triggerType" = $3,
      "intervalValue" = $4,
      "scopeType" = $5,
      "inspectionFormId" = $6,
      "active" = $7,
      "updatedAt" = $8
    WHERE "id" = $9
    `,
    nextName,
    nextServiceLabel,
    nextTriggerType,
    intervalCandidate,
    nextScopeType,
    nextInspectionFormId,
    nextActive ? 1 : 0,
    nowIso(),
    ruleId,
  );

  await run(`DELETE FROM "MaintenanceRuleAssetScope" WHERE "ruleId" = $1`, ruleId);
  await run(`DELETE FROM "MaintenanceRuleUnitScope" WHERE "ruleId" = $1`, ruleId);
  for (const assetId of nextAssetIds) {
    await run(
      `
      INSERT INTO "MaintenanceRuleAssetScope" ("id", "ruleId", "assetId")
      VALUES ($1, $2, $3)
      ON CONFLICT ("ruleId", "assetId") DO NOTHING
      `,
      randomUUID(),
      ruleId,
      assetId,
    );
  }
  for (const inventoryId of nextUnitIds) {
    await run(
      `
      INSERT INTO "MaintenanceRuleUnitScope" ("id", "ruleId", "inventoryId")
      VALUES ($1, $2, $3)
      ON CONFLICT ("ruleId", "inventoryId") DO NOTHING
      `,
      randomUUID(),
      ruleId,
      inventoryId,
    );
  }

  await run(
    `
    DELETE FROM "MaintenanceTask"
    WHERE "ruleId" = $1
      AND "status" != 'COMPLETED'
    `,
    ruleId,
  );

  const previousAffectedIds = await inventoryIdsForRuleScope(
    existing.scopeType,
    currentAssetIds,
    currentUnitIds,
  );
  const nextAffectedIds = await inventoryIdsForRuleScope(
    nextScopeType,
    nextAssetIds,
    nextUnitIds,
  );
  const combinedIds = Array.from(new Set([...previousAffectedIds, ...nextAffectedIds]));
  await evaluateMaintenanceRulesForUnits(combinedIds);

  const rules = await listRules();
  const updated = rules.find((rule) => rule.id === ruleId);
  res.json(updated || null);
});

apiMaintenanceAutomationRouter.delete("/rules/:id", requireAdmin, async (req, res) => {
  await ensureMaintenanceAutomationSchema();
  const ruleId = typeof req.params.id === "string" ? req.params.id.trim() : "";
  if (!ruleId) {
    res.status(400).json({ error: "Invalid rule id." });
    return;
  }

  const existingRows = await queryRows<{ id: string }>(
    `SELECT "id" FROM "MaintenanceRule" WHERE "id" = $1`,
    ruleId,
  );
  if (existingRows.length === 0) {
    res.status(404).json({ error: "Maintenance rule not found." });
    return;
  }

  const affectedByTasks = await queryRows<{ inventoryId: string }>(
    `SELECT DISTINCT "inventoryId" FROM "MaintenanceTask" WHERE "ruleId" = $1`,
    ruleId,
  );
  const affectedByUnits = await queryRows<{ inventoryId: string }>(
    `SELECT "inventoryId" FROM "MaintenanceRuleUnitScope" WHERE "ruleId" = $1`,
    ruleId,
  );
  const affectedByAssets = await queryRows<{ id: string }>(
    `
    SELECT "Inventory"."id"
    FROM "Inventory"
    INNER JOIN "MaintenanceRuleAssetScope"
      ON "MaintenanceRuleAssetScope"."assetId" = "Inventory"."assetId"
    WHERE "MaintenanceRuleAssetScope"."ruleId" = $1
    `,
    ruleId,
  );
  const affectedInventoryIds = Array.from(
    new Set([
      ...affectedByTasks.map((row) => row.inventoryId),
      ...affectedByUnits.map((row) => row.inventoryId),
      ...affectedByAssets.map((row) => row.id),
    ]),
  );

  await run(`DELETE FROM "MaintenanceRule" WHERE "id" = $1`, ruleId);
  await refreshInventoryMaintenanceStateForUnits(affectedInventoryIds);
  res.status(204).send();
});

apiMaintenanceAutomationRouter.get("/tasks", async (req, res) => {
  await ensureMaintenanceAutomationSchema();
  const statusFilter =
    typeof req.query.status === "string" ? req.query.status.trim().toLowerCase() : "open";
  const where =
    statusFilter === "all" ? "" : `WHERE "MaintenanceTask"."status" != 'COMPLETED'`;

  const tasks = await queryRows<{
    id: string;
    ruleId: string;
    inventoryId: string;
    triggerType: TriggerType;
    dueValue: number;
    currentValue: number;
    status: TaskStatus;
    reason: string;
    inspectionFormId: string | null;
    assignedTechName: string | null;
    createdAt: string;
    updatedAt: string;
    completedAt: string | null;
    completionInspectionSubmissionId: string | null;
    ruleName: string;
    serviceLabel: string;
    intervalValue: number;
    unitNumber: string;
    assetType: string | null;
    assetDescription: string | null;
    inspectionFormName: string | null;
  }>(
    `
    SELECT
      "MaintenanceTask"."id" AS "id",
      "MaintenanceTask"."ruleId" AS "ruleId",
      "MaintenanceTask"."inventoryId" AS "inventoryId",
      "MaintenanceTask"."triggerType" AS "triggerType",
      "MaintenanceTask"."dueValue" AS "dueValue",
      "MaintenanceTask"."currentValue" AS "currentValue",
      "MaintenanceTask"."status" AS "status",
      "MaintenanceTask"."reason" AS "reason",
      "MaintenanceTask"."inspectionFormId" AS "inspectionFormId",
      "MaintenanceTask"."assignedTechName" AS "assignedTechName",
      "MaintenanceTask"."createdAt" AS "createdAt",
      "MaintenanceTask"."updatedAt" AS "updatedAt",
      "MaintenanceTask"."completedAt" AS "completedAt",
      "MaintenanceTask"."completionInspectionSubmissionId" AS "completionInspectionSubmissionId",
      "MaintenanceRule"."name" AS "ruleName",
      "MaintenanceRule"."serviceLabel" AS "serviceLabel",
      "MaintenanceRule"."intervalValue" AS "intervalValue",
      "Inventory"."unitNumber" AS "unitNumber",
      "Asset"."type" AS "assetType",
      "Asset"."description" AS "assetDescription",
      "InspectionForm"."name" AS "inspectionFormName"
    FROM "MaintenanceTask"
    LEFT JOIN "MaintenanceRule" ON "MaintenanceRule"."id" = "MaintenanceTask"."ruleId"
    LEFT JOIN "Inventory" ON "Inventory"."id" = "MaintenanceTask"."inventoryId"
    LEFT JOIN "Asset" ON "Asset"."id" = "Inventory"."assetId"
    LEFT JOIN "InspectionForm" ON "InspectionForm"."id" = "MaintenanceTask"."inspectionFormId"
    ${where}
    ORDER BY "MaintenanceTask"."createdAt" DESC
    `,
  );

  res.json(tasks);
});

apiMaintenanceAutomationRouter.patch(
  "/tasks/:id/assign-tech",
  requireTechOrAdmin,
  async (req, res) => {
    await ensureMaintenanceAutomationSchema();
    const taskId = typeof req.params.id === "string" ? req.params.id.trim() : "";
    if (!taskId) {
      res.status(400).json({ error: "Invalid task id." });
      return;
    }
    const body = req.body as Record<string, unknown>;
    const assignedTechName =
      typeof body.assignedTechName === "string" ? body.assignedTechName.trim() : "";
    await setTaskAssignedTechName(taskId, assignedTechName || null);
    res.json({ ok: true });
  },
);

apiMaintenanceAutomationRouter.post("/tasks/:id/complete", requireTechOrAdmin, async (req, res) => {
  await ensureMaintenanceAutomationSchema();
  const taskId = typeof req.params.id === "string" ? req.params.id.trim() : "";
  if (!taskId) {
    res.status(400).json({ error: "Invalid task id." });
    return;
  }

  const taskRows = await queryRows<{
    id: string;
    inventoryId: string;
    status: TaskStatus;
    createdAt: string;
    inspectionFormId: string | null;
  }>(
    `
    SELECT "id", "inventoryId", "status", "createdAt", "inspectionFormId"
    FROM "MaintenanceTask"
    WHERE "id" = $1
    `,
    taskId,
  );
  const task = taskRows[0];
  if (!task) {
    res.status(404).json({ error: "Maintenance task not found." });
    return;
  }
  if (task.status === "COMPLETED") {
    res.json({ ok: true, alreadyCompleted: true });
    return;
  }

  const latestInspectionRows = await queryRows<{
    id: string;
    formId: string;
    submittedAt: string;
  }>(
    `
    SELECT "id", "formId", "submittedAt"
    FROM "InspectionSubmission"
    WHERE "inventoryId" = $1
      AND "submittedAt" >= $2
    ORDER BY "submittedAt" DESC
    LIMIT 1
    `,
    task.inventoryId,
    task.createdAt,
  );
  const latestInspection = latestInspectionRows[0];
  if (!latestInspection) {
    res.status(400).json({
      error:
        "Inspection is required before completing this service task. Submit inspection first.",
    });
    return;
  }
  if (
    task.inspectionFormId &&
    latestInspection.formId !== task.inspectionFormId
  ) {
    res.status(400).json({
      error:
        "Latest inspection used a different form than this service task requires.",
    });
    return;
  }

  const completedAt = nowIso();
  await run(
    `
    UPDATE "MaintenanceTask"
    SET "status" = 'COMPLETED',
        "completedAt" = $1,
        "completionInspectionSubmissionId" = $2,
        "updatedAt" = $3
    WHERE "id" = $4
    `,
    completedAt,
    latestInspection.id,
    completedAt,
    task.id,
  );

  await refreshInventoryMaintenanceStateForUnits([task.inventoryId]);
  res.json({ ok: true });
});

apiMaintenanceAutomationRouter.post("/recheck-all", requireAdmin, async (_req, res) => {
  await evaluateMaintenanceRulesForAllUnits();
  res.json({ ok: true });
});
