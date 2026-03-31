import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type AssignedUnit = {
  unitId: string;
  unitNumber: string;
  type: string;
};

export type ReservationRecord = {
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

export type OnRentRecord = ReservationRecord & {
  activatedAt: string;
};

export type ReturnedOnRentRecord = OnRentRecord & {
  returnedAt: string;
};

type ReservationState = {
  orderCounter: number;
  reservations: ReservationRecord[];
  onRent: OnRentRecord[];
  returnedOnRent: ReturnedOnRentRecord[];
  potentials: ReservationRecord[];
  lastRentedByUnit: Record<string, string>;
};

const stateFile = join(process.cwd(), "data", "reservations-state.json");
let cache: ReservationState | null = null;

function defaultState(): ReservationState {
  return {
    orderCounter: 0,
    reservations: [],
    onRent: [],
    returnedOnRent: [],
    potentials: [],
    lastRentedByUnit: {},
  };
}

function sanitize(raw: unknown): ReservationState {
  if (!raw || typeof raw !== "object") return defaultState();
  const obj = raw as Partial<ReservationState>;
  return {
    orderCounter: Number.isFinite(obj.orderCounter) ? Number(obj.orderCounter) : 0,
    reservations: Array.isArray(obj.reservations) ? (obj.reservations as ReservationRecord[]) : [],
    onRent: Array.isArray(obj.onRent) ? (obj.onRent as OnRentRecord[]) : [],
    returnedOnRent: Array.isArray(obj.returnedOnRent)
      ? (obj.returnedOnRent as ReturnedOnRentRecord[])
      : [],
    potentials: Array.isArray(obj.potentials) ? (obj.potentials as ReservationRecord[]) : [],
    lastRentedByUnit:
      obj.lastRentedByUnit && typeof obj.lastRentedByUnit === "object"
        ? (obj.lastRentedByUnit as Record<string, string>)
        : {},
  };
}

function loadState(): ReservationState {
  if (cache) return cache;
  try {
    if (!existsSync(stateFile)) {
      cache = defaultState();
      persist();
      return cache;
    }
    const raw = readFileSync(stateFile, "utf8");
    cache = sanitize(JSON.parse(raw));
    return cache;
  } catch {
    cache = defaultState();
    return cache;
  }
}

function persist() {
  if (!cache) return;
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, JSON.stringify(cache, null, 2), "utf8");
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nextOrderNumber(state: ReservationState): string {
  state.orderCounter += 1;
  return `ORD-${String(state.orderCounter).padStart(5, "0")}`;
}

function normalizeKeyPart(value: string): string {
  return value.trim().toLowerCase();
}

function onRentBatchKey(input: Pick<ReservationRecord, "customerName" | "startDate" | "startTime">): string {
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

export function getReservationsSnapshot() {
  const state = loadState();
  return clone({
    reservations: state.reservations,
    onRent: state.onRent,
    returnedOnRent: state.returnedOnRent,
    lastRentedByUnit: state.lastRentedByUnit,
  });
}

export function getLastRentedByUnit() {
  const state = loadState();
  return clone(state.lastRentedByUnit);
}

export function addReservation(input: Omit<ReservationRecord, "id" | "orderNumber" | "createdAt">) {
  const state = loadState();
  const created: ReservationRecord = {
    ...input,
    id: randomUUID(),
    orderNumber: nextOrderNumber(state),
    createdAt: new Date().toISOString(),
  };
  state.reservations.unshift(created);
  persist();
  return clone(created);
}

export function activateReservation(id: string, activatedAt: string) {
  const state = loadState();
  const index = state.reservations.findIndex((r) => r.id === id);
  if (index < 0) return null;
  const [reservation] = state.reservations.splice(index, 1);
  if (!reservation) return null;
  const onRent: OnRentRecord = { ...reservation, activatedAt };
  state.onRent.unshift(onRent);
  for (const unit of reservation.assignedUnits) {
    state.lastRentedByUnit[unit.unitId] = activatedAt;
  }
  persist();
  return clone(onRent);
}

export function cancelReservation(id: string) {
  const state = loadState();
  const index = state.reservations.findIndex((r) => r.id === id);
  if (index < 0) return null;
  const [removed] = state.reservations.splice(index, 1);
  if (!removed) return null;
  persist();
  return clone(removed);
}

export function moveReservationToPotential(id: string) {
  const state = loadState();
  const index = state.reservations.findIndex((r) => r.id === id);
  if (index < 0) return null;
  const [reservation] = state.reservations.splice(index, 1);
  if (!reservation) return null;
  state.potentials.unshift(reservation);
  persist();
  return clone(reservation);
}

export function swapReservationUnit(
  id: string,
  removeUnitId: string,
  addUnit: AssignedUnit,
) {
  const state = loadState();
  const reservation = state.reservations.find((r) => r.id === id);
  if (!reservation) return null;

  const removeIndex = reservation.assignedUnits.findIndex(
    (u) => u.unitId === removeUnitId,
  );
  if (removeIndex < 0) return null;

  const duplicate = reservation.assignedUnits.some(
    (u, idx) => u.unitId === addUnit.unitId && idx !== removeIndex,
  );
  if (duplicate) return null;

  reservation.assignedUnits[removeIndex] = addUnit;
  persist();
  return clone(reservation);
}

export function endOnRentBatch(id: string, returnedAt: string) {
  const state = loadState();
  const target = state.onRent.find((order) => order.id === id);
  if (!target) return null;

  const targetBatchKey = onRentBatchKey(target);
  const endedEntries = state.onRent.filter(
    (order) => onRentBatchKey(order) === targetBatchKey,
  );
  if (endedEntries.length === 0) return null;

  state.onRent = state.onRent.filter(
    (order) => onRentBatchKey(order) !== targetBatchKey,
  );
  const returnedEntries: ReturnedOnRentRecord[] = endedEntries.map((entry) => ({
    ...entry,
    returnedAt,
  }));
  state.returnedOnRent.unshift(...returnedEntries);
  persist();
  return clone(returnedEntries);
}

export function restoreReturnedOnRentBatch(id: string) {
  const state = loadState();
  const target = state.returnedOnRent.find((entry) => entry.id === id);
  if (!target) return null;

  const targetBatchKey = onRentBatchKey(target);
  const restoringEntries = state.returnedOnRent.filter(
    (entry) => onRentBatchKey(entry) === targetBatchKey,
  );
  if (restoringEntries.length === 0) return null;

  state.returnedOnRent = state.returnedOnRent.filter(
    (entry) => onRentBatchKey(entry) !== targetBatchKey,
  );

  const restoredOnRent: OnRentRecord[] = restoringEntries.map(({ returnedAt: _returnedAt, ...entry }) => entry);
  state.onRent.unshift(...restoredOnRent);
  persist();
  return clone(restoredOnRent);
}

export function removeReturnedOnRentUnit(unitId: string) {
  const state = loadState();
  const normalizedUnitId = String(unitId || "").trim();
  if (!normalizedUnitId) return false;

  let changed = false;

  state.returnedOnRent = state.returnedOnRent.flatMap((entry) => {
    const hasTargetUnit = entry.assignedUnits.some(
      (unit) => unit.unitId === normalizedUnitId,
    );
    if (!hasTargetUnit) return [entry];

    changed = true;
    const remainingUnits = entry.assignedUnits.filter(
      (unit) => unit.unitId !== normalizedUnitId,
    );
    if (remainingUnits.length === 0) return [];

    return [
      {
        ...entry,
        assignedUnits: remainingUnits,
        quantity: remainingUnits.length,
      },
    ];
  });

  if (changed) persist();
  return changed;
}

export function swapOnRentUnit(
  id: string,
  removeUnitId: string,
  addUnit: AssignedUnit,
  swappedAt: string,
) {
  const state = loadState();
  const order = state.onRent.find((entry) => entry.id === id);
  if (!order) return null;

  const removeIndex = order.assignedUnits.findIndex(
    (unit) => unit.unitId === removeUnitId,
  );
  if (removeIndex < 0) return null;

  const duplicate = order.assignedUnits.some(
    (unit, idx) => unit.unitId === addUnit.unitId && idx !== removeIndex,
  );
  if (duplicate) return null;

  order.assignedUnits[removeIndex] = addUnit;
  state.lastRentedByUnit[addUnit.unitId] = swappedAt;
  persist();
  return clone(order);
}
