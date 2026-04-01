/** One-time SQLite → Postgres copy. Usage: `npx tsx scripts/migrate-from-sqlite.ts [--force] [dev.db]` */

import "../src/loadEnv.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { Prisma, ReservationListKind } from "@prisma/client";
import { ensureMaintenanceAutomationSchema } from "../src/lib/maintenanceAutomation.js";
import { prisma } from "../src/lib/prisma.js";

function openSqlite(path: string): Database.Database {
  if (!existsSync(path)) {
    console.error(`SQLite file not found: ${path}`);
    process.exit(1);
  }
  return new Database(path, { readonly: true });
}

function hasTable(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
    .get(name);
  return Boolean(row);
}

function rows(db: Database.Database, table: string): Record<string, unknown>[] {
  if (!hasTable(db, table)) return [];
  return db.prepare(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[];
}

function bool(v: unknown): boolean {
  return v === 1 || v === true || v === "1";
}

function dt(v: unknown): Date {
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(v);
  return new Date(String(v));
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string {
  return String(v ?? "");
}

async function clearPostgres(force: boolean) {
  const count = await prisma.asset.count();
  if (count > 0 && !force) {
    console.error(
      "PostgreSQL already has data. Re-run with --force to wipe Rentel tables in Supabase and import from SQLite.",
    );
    process.exit(1);
  }
  if (!force && count === 0) {
    return;
  }

  console.log("Clearing existing data in PostgreSQL (--force)...");
  await prisma.$transaction(async (tx) => {
    await tx.inspectionSubmissionItem.deleteMany();
    await tx.inspectionSubmission.deleteMany();
    await tx.repairHistoryEntry.deleteMany();
    await tx.onRentHourSnapshot.deleteMany();
    await tx.inventory.deleteMany();
    await tx.asset.deleteMany();
    await tx.inspectionFormItem.deleteMany();
    await tx.inspectionForm.deleteMany();
    await tx.inspectionConfig.deleteMany();
    await tx.inventoryStatusOption.deleteMany();
    await tx.technician.deleteMany();
    await tx.reservationEntry.deleteMany();
    await tx.lastRentedByUnit.deleteMany();
    await tx.reservationMeta.deleteMany();
  });

  const maint = [
    "MaintenanceTask",
    "MaintenanceRuleUnitScope",
    "MaintenanceRuleAssetScope",
    "MaintenanceRule",
    "InventoryMaintenanceCounter",
  ];
  for (const t of maint) {
    try {
      await prisma.$executeRawUnsafe(`DELETE FROM "${t}"`);
    } catch {
      /* table may not exist yet */
    }
  }
}

async function main() {

  const argv = process.argv.slice(2).filter((a) => a !== "--force");
  const force = process.argv.includes("--force");

  let sqlitePath = argv[0];
  if (!sqlitePath) {
    const candidates = [join(process.cwd(), "prisma", "dev.db"), join(process.cwd(), "dev.db")];
    sqlitePath = candidates.find((p) => existsSync(p));
    if (!sqlitePath) {
      console.error("Pass path to dev.db or place it at prisma/dev.db or dev.db");
      process.exit(1);
    }
  }

  console.log(`Reading SQLite: ${sqlitePath}`);
  const db = openSqlite(sqlitePath);

  await clearPostgres(force);

  console.log("Importing Prisma-managed tables...");

  for (const r of rows(db, "InspectionConfig")) {
    const id = str(r.id) || "default";
    await prisma.inspectionConfig.upsert({
      where: { id },
      create: {
        id,
        requireHourMeterEntry: bool(r.requireHourMeterEntry),
        createdAt: dt(r.createdAt),
        updatedAt: dt(r.updatedAt),
      },
      update: {
        requireHourMeterEntry: bool(r.requireHourMeterEntry),
        updatedAt: dt(r.updatedAt),
      },
    });
  }

  for (const r of rows(db, "InspectionForm")) {
    await prisma.inspectionForm.create({
      data: {
        id: str(r.id),
        name: str(r.name),
        active: bool(r.active),
        requireHourMeterEntry: bool(r.requireHourMeterEntry),
        createdAt: dt(r.createdAt),
        updatedAt: dt(r.updatedAt),
      },
    });
  }

  for (const r of rows(db, "InspectionFormItem")) {
    await prisma.inspectionFormItem.create({
      data: {
        id: str(r.id),
        formId: str(r.formId),
        label: str(r.label),
        sortOrder: Number(r.sortOrder) || 0,
        active: bool(r.active),
        allowOk: bool(r.allowOk),
        allowNeedsAttention: bool(r.allowNeedsAttention),
        allowDamaged: bool(r.allowDamaged),
        allowNa: bool(r.allowNa),
        createdAt: dt(r.createdAt),
        updatedAt: dt(r.updatedAt),
      },
    });
  }

  for (const r of rows(db, "Asset")) {
    await prisma.asset.create({
      data: {
        id: str(r.id),
        asset: str(r.asset),
        type: str(r.type),
        description: r.description != null ? str(r.description) : null,
        active: r.active === undefined ? true : bool(r.active),
        inspectionFormId: r.inspectionFormId != null ? str(r.inspectionFormId) : null,
        createdAt: dt(r.createdAt),
      },
    });
  }

  for (const r of rows(db, "Inventory")) {
    await prisma.inventory.create({
      data: {
        id: str(r.id),
        assetId: str(r.assetId),
        unitNumber: str(r.unitNumber),
        hours: num(r.hours),
        status: str(r.status) || "AVAILABLE",
        downReason: r.downReason != null ? str(r.downReason) : null,
        inspectionRequired: bool(r.inspectionRequired),
        lastInspectionCompletedAt:
          r.lastInspectionCompletedAt != null ? dt(r.lastInspectionCompletedAt) : null,
        createdAt: dt(r.createdAt),
      },
    });
  }

  for (const r of rows(db, "InventoryStatusOption")) {
    await prisma.inventoryStatusOption.create({
      data: {
        id: str(r.id),
        value: str(r.value),
        createdAt: dt(r.createdAt),
      },
    });
  }

  for (const r of rows(db, "Technician")) {
    await prisma.technician.create({
      data: {
        id: str(r.id),
        techName: str(r.techName),
        username: str(r.username),
        password: str(r.password),
        active: r.active === undefined ? true : bool(r.active),
        createdAt: dt(r.createdAt),
        updatedAt: dt(r.updatedAt),
      },
    });
  }

  for (const r of rows(db, "OnRentHourSnapshot")) {
    await prisma.onRentHourSnapshot.create({
      data: {
        id: str(r.id),
        inventoryId: str(r.inventoryId),
        hoursAtOnRent: num(r.hoursAtOnRent),
        capturedAt: dt(r.capturedAt),
      },
    });
  }

  for (const r of rows(db, "RepairHistoryEntry")) {
    await prisma.repairHistoryEntry.create({
      data: {
        id: str(r.id),
        inventoryId: str(r.inventoryId),
        action: str(r.action),
        details: r.details != null ? str(r.details) : null,
        techName: r.techName != null ? str(r.techName) : null,
        repairHours: num(r.repairHours),
        laborHours: num(r.laborHours),
        createdAt: dt(r.createdAt),
      },
    });
  }

  for (const r of rows(db, "InspectionSubmission")) {
    await prisma.inspectionSubmission.create({
      data: {
        id: str(r.id),
        inventoryId: str(r.inventoryId),
        formId: r.formId != null ? str(r.formId) : null,
        submittedAt: dt(r.submittedAt),
        hourMeterReading: num(r.hourMeterReading),
      },
    });
  }

  for (const r of rows(db, "InspectionSubmissionItem")) {
    await prisma.inspectionSubmissionItem.create({
      data: {
        id: str(r.id),
        submissionId: str(r.submissionId),
        formItemId: r.formItemId != null ? str(r.formItemId) : null,
        labelSnapshot: str(r.labelSnapshot),
        checked: bool(r.checked),
        selectedOk: bool(r.selectedOk),
        selectedNeedsAttention: bool(r.selectedNeedsAttention),
        selectedDamaged: bool(r.selectedDamaged),
        selectedNa: bool(r.selectedNa),
      },
    });
  }

  for (const r of rows(db, "ReservationMeta")) {
    const id = str(r.id) || "default";
    const orderCounter = Number(r.orderCounter) || 0;
    await prisma.reservationMeta.upsert({
      where: { id },
      create: { id, orderCounter },
      update: { orderCounter },
    });
  }

  for (const r of rows(db, "LastRentedByUnit")) {
    await prisma.lastRentedByUnit.create({
      data: {
        unitId: str(r.unitId),
        activatedAtIso: str(r.activatedAtIso),
      },
    });
  }

  for (const r of rows(db, "ReservationEntry")) {
    const raw = r.assignedUnits;
    const assigned = (
      typeof raw === "string" ? JSON.parse(raw) : raw
    ) as Prisma.InputJsonValue;
    const kind = str(r.listKind) as ReservationListKind;
    await prisma.reservationEntry.create({
      data: {
        id: str(r.id),
        orderNumber: str(r.orderNumber),
        customerName: str(r.customerName),
        address: str(r.address),
        startDate: str(r.startDate),
        startTime: str(r.startTime),
        endDate: str(r.endDate),
        endTime: str(r.endTime),
        rentalType: str(r.type ?? r.rentalType),
        quantity: Number(r.quantity) || 0,
        assignedUnits: assigned,
        groupKey: str(r.groupKey),
        createdAt: dt(r.createdAt),
        listKind: kind,
        listEnteredAt: r.listEnteredAt != null ? dt(r.listEnteredAt) : dt(r.createdAt),
        activatedAt: r.activatedAt != null ? dt(r.activatedAt) : null,
        returnedAt: r.returnedAt != null ? dt(r.returnedAt) : null,
      },
    });
  }

  console.log("Ensuring maintenance automation tables on PostgreSQL...");
  await ensureMaintenanceAutomationSchema();

  console.log("Importing maintenance tables (if present in SQLite)...");

  for (const r of rows(db, "InventoryMaintenanceCounter")) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "InventoryMaintenanceCounter" ("inventoryId", "rentalCycleCount", "updatedAt") VALUES ($1, $2, $3) ON CONFLICT ("inventoryId") DO NOTHING`,
      str(r.inventoryId),
      Number(r.rentalCycleCount) || 0,
      str(r.updatedAt),
    );
  }

  for (const r of rows(db, "MaintenanceRule")) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "MaintenanceRule" ("id", "name", "serviceLabel", "triggerType", "intervalValue", "scopeType", "inspectionFormId", "active", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT ("id") DO NOTHING`,
      str(r.id),
      str(r.name),
      str(r.serviceLabel),
      str(r.triggerType),
      Number(r.intervalValue) || 0,
      str(r.scopeType),
      r.inspectionFormId != null ? str(r.inspectionFormId) : null,
      Number(r.active) !== 0 ? 1 : 0,
      str(r.createdAt),
      str(r.updatedAt),
    );
  }

  for (const r of rows(db, "MaintenanceRuleAssetScope")) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "MaintenanceRuleAssetScope" ("id", "ruleId", "assetId") VALUES ($1, $2, $3) ON CONFLICT ("ruleId", "assetId") DO NOTHING`,
      str(r.id),
      str(r.ruleId),
      str(r.assetId),
    );
  }

  for (const r of rows(db, "MaintenanceRuleUnitScope")) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "MaintenanceRuleUnitScope" ("id", "ruleId", "inventoryId") VALUES ($1, $2, $3) ON CONFLICT ("ruleId", "inventoryId") DO NOTHING`,
      str(r.id),
      str(r.ruleId),
      str(r.inventoryId),
    );
  }

  for (const r of rows(db, "MaintenanceTask")) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "MaintenanceTask" ("id", "ruleId", "inventoryId", "triggerType", "dueValue", "currentValue", "status", "reason", "inspectionFormId", "assignedTechName", "createdAt", "updatedAt", "completedAt", "completionInspectionSubmissionId") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) ON CONFLICT ("id") DO NOTHING`,
      str(r.id),
      str(r.ruleId),
      str(r.inventoryId),
      str(r.triggerType),
      Number(r.dueValue) || 0,
      Number(r.currentValue) || 0,
      str(r.status),
      str(r.reason),
      r.inspectionFormId != null ? str(r.inspectionFormId) : null,
      r.assignedTechName != null ? str(r.assignedTechName) : null,
      str(r.createdAt),
      str(r.updatedAt),
      r.completedAt != null ? str(r.completedAt) : null,
      r.completionInspectionSubmissionId != null
        ? str(r.completionInspectionSubmissionId)
        : null,
    );
  }

  db.close();
  await prisma.$disconnect();

  console.log("Done. Start the app with npm run dev and verify your data in the UI.");
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
