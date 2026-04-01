import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

type AssignedUnit = {
  unitId: string;
  unitNumber: string;
  type: string;
};

type ReservationRecord = {
  id: string;
  orderNumber: string;
  customerName: string;
  address: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  type: string;
  quantity: number;
  assignedUnits: AssignedUnit[];
  groupKey: string;
  createdAt: string;
};

type OnRentRecord = ReservationRecord & {
  activatedAt: string;
};

type ReturnedOnRentRecord = OnRentRecord & {
  returnedAt: string;
};

function jsonIdPart(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return String(value).trim();
}

function normalizeAssignedUnit(raw: unknown): AssignedUnit | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const unitId = jsonIdPart(o.unitId) || jsonIdPart(o.id);
  if (!unitId) return null;
  const unitNumber =
    typeof o.unitNumber === "string"
      ? o.unitNumber
      : String(o.unitNumber ?? "");
  const type = typeof o.type === "string" ? o.type : String(o.type ?? "");
  return { unitId, unitNumber, type };
}

function parseUnits(raw: Prisma.JsonValue): AssignedUnit[] {
  if (!Array.isArray(raw)) return [];
  const out: AssignedUnit[] = [];
  for (const item of raw) {
    const u = normalizeAssignedUnit(item);
    if (u) out.push(u);
  }
  return out;
}

function rowToReservationRecord(row: {
  id: string;
  orderNumber: string;
  customerName: string;
  address: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  rentalType: string;
  quantity: number;
  assignedUnits: Prisma.JsonValue;
  groupKey: string;
  createdAt: Date;
}): ReservationRecord {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    customerName: row.customerName,
    address: row.address,
    startDate: row.startDate,
    startTime: row.startTime,
    endDate: row.endDate,
    endTime: row.endTime,
    type: row.rentalType,
    quantity: row.quantity,
    assignedUnits: parseUnits(row.assignedUnits),
    groupKey: row.groupKey,
    createdAt: row.createdAt.toISOString(),
  };
}

function rowToOnRent(row: {
  id: string;
  orderNumber: string;
  customerName: string;
  address: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  rentalType: string;
  quantity: number;
  assignedUnits: Prisma.JsonValue;
  groupKey: string;
  createdAt: Date;
  activatedAt: Date | null;
}): OnRentRecord {
  const base = rowToReservationRecord(row);
  return {
    ...base,
    activatedAt: (row.activatedAt ?? row.createdAt).toISOString(),
  };
}

function rowToReturned(row: {
  id: string;
  orderNumber: string;
  customerName: string;
  address: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  rentalType: string;
  quantity: number;
  assignedUnits: Prisma.JsonValue;
  groupKey: string;
  createdAt: Date;
  activatedAt: Date | null;
  returnedAt: Date | null;
}): ReturnedOnRentRecord {
  const onRent = rowToOnRent(row);
  return {
    ...onRent,
    returnedAt: (row.returnedAt ?? new Date()).toISOString(),
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeKeyPart(value: string): string {
  return value.trim().toLowerCase();
}

function onRentBatchKey(
  input: Pick<ReservationRecord, "customerName" | "startDate" | "startTime">,
): string {
  return [
    normalizeKeyPart(input.customerName),
    normalizeKeyPart(input.startDate),
    normalizeKeyPart(input.startTime),
  ].join("|");
}

export function reservationGroupKey(input: {
  customerName: string;
  address: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
}): string {
  return [
    normalizeKeyPart(input.customerName),
    normalizeKeyPart(input.address),
    normalizeKeyPart(input.startDate),
    normalizeKeyPart(input.startTime),
    normalizeKeyPart(input.endDate),
    normalizeKeyPart(input.endTime),
  ].join("|");
}

export async function getReservationsSnapshot() {
  const [reservations, onRent, returnedOnRent, potentials, lastRows] = await Promise.all([
    prisma.reservationEntry.findMany({
      where: { listKind: "RESERVATION" },
      orderBy: { listEnteredAt: "desc" },
    }),
    prisma.reservationEntry.findMany({
      where: { listKind: "ON_RENT" },
      orderBy: { listEnteredAt: "desc" },
    }),
    prisma.reservationEntry.findMany({
      where: { listKind: "RETURNED" },
      orderBy: { listEnteredAt: "desc" },
    }),
    prisma.reservationEntry.findMany({
      where: { listKind: "POTENTIAL" },
      orderBy: { listEnteredAt: "desc" },
    }),
    prisma.lastRentedByUnit.findMany(),
  ]);

  const lastRentedByUnit: Record<string, string> = {};
  for (const r of lastRows) {
    lastRentedByUnit[r.unitId] = r.activatedAtIso;
  }

  return clone({
    reservations: reservations.map(rowToReservationRecord),
    onRent: onRent.map(rowToOnRent),
    returnedOnRent: returnedOnRent.map(rowToReturned),
    potentials: potentials.map(rowToReservationRecord),
    lastRentedByUnit,
  });
}

export async function getLastRentedByUnit() {
  const rows = await prisma.lastRentedByUnit.findMany();
  const lastRentedByUnit: Record<string, string> = {};
  for (const r of rows) {
    lastRentedByUnit[r.unitId] = r.activatedAtIso;
  }
  return clone(lastRentedByUnit);
}

export async function addReservation(
  input: Omit<ReservationRecord, "id" | "orderNumber" | "createdAt">,
) {
  const created = await prisma.$transaction(async (tx) => {
    const meta = await tx.reservationMeta.upsert({
      where: { id: "default" },
      create: { id: "default", orderCounter: 0 },
      update: {},
    });
    const next = meta.orderCounter + 1;
    await tx.reservationMeta.update({
      where: { id: "default" },
      data: { orderCounter: next },
    });
    const orderNumber = `ORD-${String(next).padStart(5, "0")}`;
    const id = randomUUID();
    const now = new Date();
    const row = await tx.reservationEntry.create({
      data: {
        id,
        orderNumber,
        customerName: input.customerName,
        address: input.address,
        startDate: input.startDate,
        startTime: input.startTime,
        endDate: input.endDate,
        endTime: input.endTime,
        rentalType: input.type,
        quantity: input.quantity,
        assignedUnits: input.assignedUnits as unknown as Prisma.InputJsonValue,
        groupKey: input.groupKey,
        createdAt: now,
        listKind: "RESERVATION",
        listEnteredAt: now,
      },
    });
    return row;
  });

  return clone(rowToReservationRecord(created));
}

export async function activateReservation(id: string, activatedAtIso: string) {
  const activatedAt = new Date(activatedAtIso);
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.reservationEntry.findFirst({
      where: { id, listKind: "RESERVATION" },
    });
    if (!row) return null;

    const moved = await tx.reservationEntry.update({
      where: { id },
      data: {
        listKind: "ON_RENT",
        activatedAt,
        listEnteredAt: activatedAt,
      },
    });

    const units = parseUnits(moved.assignedUnits);
    for (const unit of units) {
      await tx.lastRentedByUnit.upsert({
        where: { unitId: unit.unitId },
        create: { unitId: unit.unitId, activatedAtIso },
        update: { activatedAtIso },
      });
    }
    return moved;
  });

  if (!updated) return null;
  return clone(rowToOnRent(updated));
}

export async function cancelReservation(id: string) {
  const row = await prisma.reservationEntry.findFirst({
    where: { id, listKind: "RESERVATION" },
  });
  if (!row) return null;
  await prisma.reservationEntry.delete({ where: { id } });
  return clone(rowToReservationRecord(row));
}

export async function moveReservationToPotential(id: string) {
  const now = new Date();
  const row = await prisma.reservationEntry.findFirst({
    where: { id, listKind: "RESERVATION" },
  });
  if (!row) return null;
  const updated = await prisma.reservationEntry.update({
    where: { id },
    data: {
      listKind: "POTENTIAL",
      assignedUnits: [] as unknown as Prisma.InputJsonValue,
      listEnteredAt: now,
    },
  });
  return clone(rowToReservationRecord(updated));
}

export async function deletePotential(id: string) {
  const row = await prisma.reservationEntry.findFirst({
    where: { id, listKind: "POTENTIAL" },
  });
  if (!row) return null;
  await prisma.reservationEntry.delete({ where: { id } });
  return clone(rowToReservationRecord(row));
}

export async function convertPotentialToReservation(id: string) {
  const now = new Date();
  const row = await prisma.reservationEntry.findFirst({
    where: { id, listKind: "POTENTIAL" },
  });
  if (!row) return null;
  const updated = await prisma.reservationEntry.update({
    where: { id },
    data: {
      listKind: "RESERVATION",
      listEnteredAt: now,
    },
  });
  return clone(rowToReservationRecord(updated));
}

export async function swapReservationUnit(
  id: string,
  removeUnitId: string,
  addUnit: AssignedUnit,
) {
  const row = await prisma.reservationEntry.findFirst({
    where: { id, listKind: "RESERVATION" },
  });
  if (!row) return null;

  const units = parseUnits(row.assignedUnits);
  const removeIndex = units.findIndex((u) => u.unitId === removeUnitId);
  if (removeIndex < 0) return null;
  const duplicate = units.some(
    (u, idx) => u.unitId === addUnit.unitId && idx !== removeIndex,
  );
  if (duplicate) return null;

  const nextUnits = [...units];
  nextUnits[removeIndex] = addUnit;

  const updated = await prisma.reservationEntry.update({
    where: { id },
    data: {
      assignedUnits: nextUnits as unknown as Prisma.InputJsonValue,
    },
  });
  return clone(rowToReservationRecord(updated));
}

export async function endOnRentBatch(id: string, returnedAtIso: string) {
  const returnedAt = new Date(returnedAtIso);

  return prisma.$transaction(async (tx) => {
    const target = await tx.reservationEntry.findFirst({
      where: { id, listKind: "ON_RENT" },
    });
    if (!target) return null;

    const batchKey = onRentBatchKey({
      customerName: target.customerName,
      startDate: target.startDate,
      startTime: target.startTime,
    });

    const allOnRent = await tx.reservationEntry.findMany({
      where: { listKind: "ON_RENT" },
      orderBy: { listEnteredAt: "desc" },
    });

    const endedEntries = allOnRent.filter(
      (o) =>
        onRentBatchKey({
          customerName: o.customerName,
          startDate: o.startDate,
          startTime: o.startTime,
        }) === batchKey,
    );
    if (endedEntries.length === 0) return null;

    const base = Date.now();
    const results: ReturnedOnRentRecord[] = [];

    for (let idx = 0; idx < endedEntries.length; idx++) {
      const entry = endedEntries[idx]!;
      const moved = await tx.reservationEntry.update({
        where: { id: entry.id },
        data: {
          listKind: "RETURNED",
          returnedAt,
          listEnteredAt: new Date(base + (endedEntries.length - 1 - idx)),
        },
      });
      results.push(rowToReturned(moved));
    }

    return clone(results);
  });
}

export async function restoreReturnedOnRentBatch(id: string) {
  return prisma.$transaction(async (tx) => {
    const target = await tx.reservationEntry.findFirst({
      where: { id, listKind: "RETURNED" },
    });
    if (!target) return null;

    const batchKey = onRentBatchKey({
      customerName: target.customerName,
      startDate: target.startDate,
      startTime: target.startTime,
    });

    const allReturned = await tx.reservationEntry.findMany({
      where: { listKind: "RETURNED" },
      orderBy: { listEnteredAt: "desc" },
    });

    const restoringEntries = allReturned.filter(
      (o) =>
        onRentBatchKey({
          customerName: o.customerName,
          startDate: o.startDate,
          startTime: o.startTime,
        }) === batchKey,
    );
    if (restoringEntries.length === 0) return null;

    const base = Date.now();
    const results: OnRentRecord[] = [];

    for (let idx = 0; idx < restoringEntries.length; idx++) {
      const entry = restoringEntries[idx]!;
      const moved = await tx.reservationEntry.update({
        where: { id: entry.id },
        data: {
          listKind: "ON_RENT",
          returnedAt: null,
          listEnteredAt: new Date(base + (restoringEntries.length - 1 - idx)),
        },
      });
      results.push(rowToOnRent(moved));
    }

    return clone(results);
  });
}

export async function removeReturnedOnRentUnit(unitId: string) {
  const normalizedUnitId = String(unitId || "").trim();
  if (!normalizedUnitId) return false;

  const rows = await prisma.reservationEntry.findMany({
    where: { listKind: "RETURNED" },
  });

  let changed = false;

  for (const row of rows) {
    const units = parseUnits(row.assignedUnits);
    const hasTarget = units.some((u) => u.unitId === normalizedUnitId);
    if (!hasTarget) continue;

    changed = true;
    const remaining = units.filter((u) => u.unitId !== normalizedUnitId);
    if (remaining.length === 0) {
      await prisma.reservationEntry.delete({ where: { id: row.id } });
    } else {
      await prisma.reservationEntry.update({
        where: { id: row.id },
        data: {
          assignedUnits: remaining as unknown as Prisma.InputJsonValue,
          quantity: remaining.length,
        },
      });
    }
  }

  return changed;
}

export async function swapOnRentUnit(
  id: string,
  removeUnitId: string,
  addUnit: AssignedUnit,
  swappedAtIso: string,
) {
  const row = await prisma.reservationEntry.findFirst({
    where: { id, listKind: "ON_RENT" },
  });
  if (!row) return null;

  const units = parseUnits(row.assignedUnits);
  const removeIndex = units.findIndex((u) => u.unitId === removeUnitId);
  if (removeIndex < 0) return null;

  const duplicate = units.some(
    (u, idx) => u.unitId === addUnit.unitId && idx !== removeIndex,
  );
  if (duplicate) return null;

  const nextUnits = [...units];
  nextUnits[removeIndex] = addUnit;

  const updated = await prisma.$transaction(async (tx) => {
    const moved = await tx.reservationEntry.update({
      where: { id },
      data: {
        assignedUnits: nextUnits as unknown as Prisma.InputJsonValue,
      },
    });
    await tx.lastRentedByUnit.upsert({
      where: { unitId: addUnit.unitId },
      create: { unitId: addUnit.unitId, activatedAtIso: swappedAtIso },
      update: { activatedAtIso: swappedAtIso },
    });
    return moved;
  });

  return clone(rowToOnRent(updated));
}

type LegacyReservationState = {
  orderCounter: number;
  reservations: ReservationRecord[];
  onRent: OnRentRecord[];
  returnedOnRent: ReturnedOnRentRecord[];
  potentials: ReservationRecord[];
  lastRentedByUnit: Record<string, string>;
};

function sanitizeLegacyJson(raw: unknown): LegacyReservationState {
  const empty: LegacyReservationState = {
    orderCounter: 0,
    reservations: [],
    onRent: [],
    returnedOnRent: [],
    potentials: [],
    lastRentedByUnit: {},
  };
  if (!raw || typeof raw !== "object") return empty;
  const obj = raw as Partial<LegacyReservationState>;
  return {
    orderCounter: Number.isFinite(obj.orderCounter) ? Number(obj.orderCounter) : 0,
    reservations: Array.isArray(obj.reservations) ? obj.reservations : [],
    onRent: Array.isArray(obj.onRent) ? obj.onRent : [],
    returnedOnRent: Array.isArray(obj.returnedOnRent) ? obj.returnedOnRent : [],
    potentials: Array.isArray(obj.potentials) ? obj.potentials : [],
    lastRentedByUnit:
      obj.lastRentedByUnit && typeof obj.lastRentedByUnit === "object"
        ? obj.lastRentedByUnit
        : {},
  };
}

/**
 * One-time import from legacy `data/reservations-state.json` when the DB has no reservation rows.
 */
export async function migrateReservationsFromJsonFileIfNeeded(): Promise<void> {
  const existing = await prisma.reservationEntry.count();
  if (existing > 0) return;

  const stateFile = join(process.cwd(), "data", "reservations-state.json");
  if (!existsSync(stateFile)) return;

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    return;
  }

  const state = sanitizeLegacyJson(raw);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.reservationMeta.upsert({
        where: { id: "default" },
        create: { id: "default", orderCounter: state.orderCounter },
        update: { orderCounter: state.orderCounter },
      });

      for (const [unitId, iso] of Object.entries(state.lastRentedByUnit)) {
        await tx.lastRentedByUnit.upsert({
          where: { unitId },
          create: { unitId, activatedAtIso: iso },
          update: { activatedAtIso: iso },
        });
      }

      async function insertList(
        rows: ReservationRecord[],
        kind: "RESERVATION" | "POTENTIAL",
      ) {
        for (const r of rows) {
          const createdAt = new Date(r.createdAt);
          await tx.reservationEntry.create({
            data: {
              id: r.id,
              orderNumber: r.orderNumber,
              customerName: r.customerName,
              address: r.address,
              startDate: r.startDate,
              startTime: r.startTime,
              endDate: r.endDate,
              endTime: r.endTime,
              rentalType: r.type,
              quantity: r.quantity,
              assignedUnits: r.assignedUnits as unknown as Prisma.InputJsonValue,
              groupKey: r.groupKey,
              createdAt,
              listKind: kind,
              listEnteredAt: createdAt,
            },
          });
        }
      }

      for (const r of state.onRent) {
        const createdAt = new Date(r.createdAt);
        const activatedAt = new Date(r.activatedAt);
        await tx.reservationEntry.create({
          data: {
            id: r.id,
            orderNumber: r.orderNumber,
            customerName: r.customerName,
            address: r.address,
            startDate: r.startDate,
            startTime: r.startTime,
            endDate: r.endDate,
            endTime: r.endTime,
            rentalType: r.type,
            quantity: r.quantity,
            assignedUnits: r.assignedUnits as unknown as Prisma.InputJsonValue,
            groupKey: r.groupKey,
            createdAt,
            listKind: "ON_RENT",
            listEnteredAt: activatedAt,
            activatedAt,
          },
        });
      }

      for (const r of state.returnedOnRent) {
        const createdAt = new Date(r.createdAt);
        const activatedAt = new Date(r.activatedAt);
        const returnedAt = new Date(r.returnedAt);
        await tx.reservationEntry.create({
          data: {
            id: r.id,
            orderNumber: r.orderNumber,
            customerName: r.customerName,
            address: r.address,
            startDate: r.startDate,
            startTime: r.startTime,
            endDate: r.endDate,
            endTime: r.endTime,
            rentalType: r.type,
            quantity: r.quantity,
            assignedUnits: r.assignedUnits as unknown as Prisma.InputJsonValue,
            groupKey: r.groupKey,
            createdAt,
            listKind: "RETURNED",
            listEnteredAt: returnedAt,
            activatedAt,
            returnedAt,
          },
        });
      }

      await insertList(state.reservations, "RESERVATION");
      await insertList(state.potentials, "POTENTIAL");
    });

    console.log("[reservations] Imported legacy data/reservations-state.json into the database.");
  } catch (err) {
    console.error("[reservations] Legacy JSON import failed:", err);
  }
}
