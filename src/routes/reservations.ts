import { Router } from "express";
import {
  evaluateMaintenanceRulesForUnits,
  incrementRentalCycleCounters,
} from "../lib/maintenanceAutomation.js";
import { prisma } from "../lib/prisma.js";
import {
  addReservation,
  activateReservation,
  cancelReservation,
  convertPotentialToReservation,
  deletePotential,
  endOnRentBatch,
  getLastRentedByUnit,
  getReservationsSnapshot,
  moveReservationToPotential,
  reservationGroupKey,
  restoreReturnedOnRentBatch,
  swapOnRentUnit,
  swapReservationUnit,
} from "../lib/reservationsState.js";
import { normalizeStatus } from "../lib/statusFormat.js";
import type { Prisma } from "@prisma/client";

export const apiReservationsRouter = Router();

const STATUS_AVAILABLE = "Available";
const STATUS_RESERVED = "Reserved";
const STATUS_ON_RENT = "On Rent";
const STATUS_RETURNED = "Returned";
const STATUS_DOWN = "Down";

function upperText(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

function parseLocalDateTime(dateText: string, timeText: string) {
  if (!dateText || !timeText) return null;
  const dt = new Date(`${dateText}T${timeText}:00`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function isWithinAutoAssignWindow(startDate: string, startTime: string) {
  const start = parseLocalDateTime(startDate, startTime);
  if (!start) return false;
  const now = new Date();
  const cutoff = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  return start.getTime() < cutoff.getTime();
}

function parseAssignedUnitsFromJson(
  raw: Prisma.JsonValue,
): Array<{ unitId: string; unitNumber: string; type: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ unitId: string; unitNumber: string; type: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const obj = item as Record<string, unknown>;
    const unitId = String(obj.unitId ?? "").trim();
    if (!unitId) continue;
    out.push({
      unitId,
      unitNumber: String(obj.unitNumber ?? "").trim(),
      type: String(obj.type ?? "").trim(),
    });
  }
  return out;
}

async function autoAssignUpcomingReservations() {
  const [reservationRows, inventoryRows, lastRentedByUnit] = await Promise.all([
    prisma.reservationEntry.findMany({
      where: { listKind: "RESERVATION" },
      orderBy: [{ startDate: "asc" }, { startTime: "asc" }, { createdAt: "asc" }],
    }),
    prisma.inventory.findMany({
      include: { asset: true },
      orderBy: { createdAt: "asc" },
    }),
    getLastRentedByUnit(),
  ]);

  const availableRows = inventoryRows.filter(
    (row) => normalizeStatus(row.status) === STATUS_AVAILABLE,
  );
  const availableById = new Map(availableRows.map((u) => [u.id, u]));
  const consumedUnitIds = new Set<string>();
  const updates: Array<{ id: string; assignedUnits: Array<{ unitId: string; unitNumber: string; type: string }> }> = [];
  const initialAssignedUnitIds = new Set<string>();
  const finalAssignedUnitIds = new Set<string>();

  for (const row of reservationRows) {
    const existingAssigned = parseAssignedUnitsFromJson(row.assignedUnits);
    existingAssigned.forEach((u) => initialAssignedUnitIds.add(u.unitId));

    if (!isWithinAutoAssignWindow(row.startDate, row.startTime)) {
      if (existingAssigned.length > 0) {
        updates.push({ id: row.id, assignedUnits: [] });
      }
      continue;
    }

    const targetType = upperText(row.rentalType);
    const keptAssigned = existingAssigned.filter((u) => {
      if (consumedUnitIds.has(u.unitId)) return false;
      if (upperText(u.type) !== targetType) return false;
      consumedUnitIds.add(u.unitId);
      return true;
    });

    const matchingAuto = availableRows
      .filter((u) => !consumedUnitIds.has(u.id))
      .filter((u) => upperText(u.asset.type) === targetType)
      .sort((a, b) => {
        const aLast = lastRentedByUnit[a.id];
        const bLast = lastRentedByUnit[b.id];
        if (!aLast && !bLast) return a.createdAt.getTime() - b.createdAt.getTime();
        if (!aLast) return -1;
        if (!bLast) return 1;
        return new Date(aLast).getTime() - new Date(bLast).getTime();
      });

    const need = Math.max(0, row.quantity - keptAssigned.length);
    const added = matchingAuto.slice(0, need).map((u) => ({
      unitId: u.id,
      unitNumber: u.unitNumber,
      type: u.asset.type,
    }));
    added.forEach((u) => consumedUnitIds.add(u.unitId));

    const nextAssigned = [...keptAssigned, ...added];
    nextAssigned.forEach((u) => finalAssignedUnitIds.add(u.unitId));

    const sameLength = nextAssigned.length === existingAssigned.length;
    const sameMembers =
      sameLength &&
      nextAssigned.every((u, idx) => {
        const curr = existingAssigned[idx];
        return (
          curr &&
          curr.unitId === u.unitId &&
          curr.unitNumber === u.unitNumber &&
          curr.type === u.type
        );
      });
    if (!sameMembers) {
      updates.push({ id: row.id, assignedUnits: nextAssigned });
    }
  }

  const releaseIds = Array.from(initialAssignedUnitIds).filter(
    (id) => !finalAssignedUnitIds.has(id),
  );
  const reserveIds = Array.from(finalAssignedUnitIds).filter((id) => availableById.has(id));

  await prisma.$transaction(async (tx) => {
    for (const update of updates) {
      await tx.reservationEntry.update({
        where: { id: update.id },
        data: { assignedUnits: update.assignedUnits as unknown as Prisma.InputJsonValue },
      });
    }
    if (releaseIds.length > 0) {
      await tx.inventory.updateMany({
        where: { id: { in: releaseIds }, status: STATUS_RESERVED },
        data: { status: STATUS_AVAILABLE, inspectionRequired: false },
      });
    }
    if (reserveIds.length > 0) {
      await tx.inventory.updateMany({
        where: { id: { in: reserveIds }, status: STATUS_AVAILABLE },
        data: { status: STATUS_RESERVED, inspectionRequired: false },
      });
    }
  });
}

function addReservationFulfillmentMeta(snapshot: Awaited<ReturnType<typeof getReservationsSnapshot>>) {
  const onRentReturnTimesByType = new Map<string, Date[]>();
  for (const order of snapshot.onRent) {
    const dt = parseLocalDateTime(order.endDate, order.endTime);
    if (!dt) continue;
    for (const unit of order.assignedUnits || []) {
      const key = upperText(unit.type);
      if (!onRentReturnTimesByType.has(key)) onRentReturnTimesByType.set(key, []);
      onRentReturnTimesByType.get(key)!.push(dt);
    }
  }
  for (const arr of onRentReturnTimesByType.values()) {
    arr.sort((a, b) => a.getTime() - b.getTime());
  }

  return {
    ...snapshot,
    reservations: snapshot.reservations.map((entry) => {
      const shortageCount = Math.max(0, entry.quantity - (entry.assignedUnits?.length || 0));
      if (shortageCount === 0) {
        return { ...entry, shortageCount: 0, expectedFulfillmentDateTime: null };
      }
      const matching = onRentReturnTimesByType.get(upperText(entry.type)) || [];
      const expected = matching.length >= shortageCount ? matching[shortageCount - 1] : null;
      return {
        ...entry,
        shortageCount,
        expectedFulfillmentDateTime: expected ? expected.toISOString() : null,
      };
    }),
  };
}

type ReservationLineItem = {
  type: string;
  quantity: number;
};

function parseLineItems(body: Record<string, unknown>): ReservationLineItem[] {
  const rawLineItems = Array.isArray(body.lineItems) ? body.lineItems : [];
  const parsed = rawLineItems
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const type = typeof row.type === "string" ? row.type.trim() : "";
      const quantityRaw = Number(row.quantity);
      const quantity = Number.isFinite(quantityRaw) ? Math.trunc(quantityRaw) : 0;
      if (!type || quantity < 1) return null;
      return { type, quantity };
    })
    .filter((x): x is ReservationLineItem => Boolean(x));

  if (parsed.length > 0) return parsed;

  const fallbackType = typeof body.type === "string" ? body.type.trim() : "";
  const fallbackQuantityRaw = Number(body.quantity);
  const fallbackQuantity = Number.isFinite(fallbackQuantityRaw)
    ? Math.trunc(fallbackQuantityRaw)
    : 0;
  if (!fallbackType || fallbackQuantity < 1) return [];
  return [{ type: fallbackType, quantity: fallbackQuantity }];
}

apiReservationsRouter.get("/", async (_req, res) => {
  await autoAssignUpcomingReservations();
  const snapshot = await getReservationsSnapshot();
  res.json(addReservationFulfillmentMeta(snapshot));
});

apiReservationsRouter.post("/", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const customerName =
    typeof body.customerName === "string" ? body.customerName.trim() : "";
  const address = typeof body.address === "string" ? body.address.trim() : "";
  const startDate =
    typeof body.startDate === "string" ? body.startDate.trim() : "";
  const startTime =
    typeof body.startTime === "string" ? body.startTime.trim() : "";
  const endDate = typeof body.endDate === "string" ? body.endDate.trim() : "";
  const endTime = typeof body.endTime === "string" ? body.endTime.trim() : "";
  const lineItems = parseLineItems(body);
  const manualUnitIds = Array.isArray(body.manualUnitIds)
    ? body.manualUnitIds.filter((x): x is string => typeof x === "string")
    : [];

  if (
    !customerName ||
    !address ||
    !startDate ||
    !startTime ||
    !endDate ||
    !endTime ||
    lineItems.length === 0
  ) {
    res.status(400).json({
      error:
        "customerName, address, startDate, startTime, endDate, endTime, and at least one type/quantity line item are required.",
    });
    return;
  }

  const inventoryRows = await prisma.inventory.findMany({
    include: { asset: true },
    orderBy: { createdAt: "asc" },
  });
  const available = inventoryRows.filter(
    (row) => normalizeStatus(row.status) === STATUS_AVAILABLE,
  );

  const availableById = new Map(available.map((u) => [u.id, u]));
  const manualUnits = manualUnitIds
    .map((id) => availableById.get(id))
    .filter((u): u is NonNullable<typeof u> => Boolean(u));

  if (manualUnits.length !== manualUnitIds.length) {
    res.status(400).json({ error: "One or more manually selected units are not available." });
    return;
  }
  const totalRequested = lineItems.reduce((sum, item) => sum + item.quantity, 0);
  if (manualUnits.length > totalRequested) {
    res.status(400).json({ error: "Manual unit selection exceeds reservation quantity." });
    return;
  }

  const perLineAssigned = new Map<number, typeof manualUnits>();
  for (let idx = 0; idx < lineItems.length; idx++) {
    perLineAssigned.set(idx, []);
  }

  const groupKey = reservationGroupKey({
    customerName,
    address,
    startDate,
    startTime,
    endDate,
    endTime,
  });
  const createdReservations = [];
  for (let idx = 0; idx < lineItems.length; idx++) {
    const line = lineItems[idx]!;
    const assigned = perLineAssigned.get(idx) || [];
    const reservation = await addReservation({
      customerName,
      address,
      startDate,
      startTime,
      endDate,
      endTime,
      type: line.type,
      quantity: line.quantity,
      assignedUnits: assigned.map((u) => ({
        unitId: u.id,
        unitNumber: u.unitNumber,
        type: u.asset.type,
      })),
      groupKey,
    });
    createdReservations.push(reservation);
  }

  await autoAssignUpcomingReservations();
  const snapshot = await getReservationsSnapshot();
  const createdIds = new Set(createdReservations.map((r) => r.id));
  const refreshedCreated = snapshot.reservations.filter((r) => createdIds.has(r.id));
  const shortages = refreshedCreated
    .map((r) => Math.max(0, r.quantity - (r.assignedUnits?.length || 0)))
    .reduce((sum, v) => sum + v, 0);

  res.status(201).json({
    created: createdReservations.length,
    reservations: refreshedCreated,
    orderNumber: createdReservations[0]?.orderNumber ?? "",
    shortageCount: shortages,
  });
});

apiReservationsRouter.post("/:id/activate", async (req, res) => {
  const { id } = req.params;
  const activatedAt = new Date().toISOString();
  const activated = await activateReservation(id, activatedAt);
  if (!activated) {
    res.status(404).json({ error: "Reservation not found." });
    return;
  }

  await prisma.inventory.updateMany({
    where: { id: { in: activated.assignedUnits.map((u) => u.unitId) } },
    data: { status: STATUS_ON_RENT, inspectionRequired: false },
  });

  res.json(activated);
});

apiReservationsRouter.post("/on-rent/:id/end-now", async (req, res) => {
  const { id } = req.params;
  const returnedAt = new Date().toISOString();
  const ended = await endOnRentBatch(id, returnedAt);
  if (!ended) {
    res.status(404).json({ error: "On Rent entry not found." });
    return;
  }

  const affectedUnitIds = Array.from(
    new Set(ended.flatMap((entry) => entry.assignedUnits.map((unit) => unit.unitId))),
  );

  if (affectedUnitIds.length > 0) {
    await prisma.inventory.updateMany({
      where: { id: { in: affectedUnitIds } },
      data: {
        status: STATUS_RETURNED,
        inspectionRequired: true,
        lastInspectionCompletedAt: null,
      },
    });
    await incrementRentalCycleCounters(affectedUnitIds);
  }

  res.json({
    ok: true,
    endedEntries: ended.length,
    returnedUnits: affectedUnitIds.length,
    ended,
  });
});

apiReservationsRouter.post("/returned/:id/restore", async (req, res) => {
  const { id } = req.params;
  const restored = await restoreReturnedOnRentBatch(id);
  if (!restored) {
    res.status(404).json({ error: "Returned entry not found." });
    return;
  }

  const affectedUnitIds = Array.from(
    new Set(restored.flatMap((entry) => entry.assignedUnits.map((unit) => unit.unitId))),
  );

  if (affectedUnitIds.length > 0) {
    await prisma.inventory.updateMany({
      where: { id: { in: affectedUnitIds } },
      data: {
        status: STATUS_ON_RENT,
        inspectionRequired: false,
      },
    });
    await evaluateMaintenanceRulesForUnits(affectedUnitIds);
  }

  res.json({
    ok: true,
    restoredEntries: restored.length,
    onRentUnits: affectedUnitIds.length,
    restored,
  });
});

apiReservationsRouter.post("/on-rent/:id/swap-unit", async (req, res) => {
  const { id } = req.params;
  const body = req.body as Record<string, unknown>;
  const removeUnitId = parseSwapUnitId(body.removeUnitId);
  const addUnitNumber =
    typeof body.addUnitNumber === "string" ? body.addUnitNumber.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  if (!removeUnitId || !addUnitNumber || !reason) {
    res.status(400).json({
      error: "removeUnitId, addUnitNumber, and reason are required.",
    });
    return;
  }

  const snapshot = await getReservationsSnapshot();
  const onRentOrder = snapshot.onRent.find((entry) => entry.id === id);
  if (!onRentOrder) {
    res.status(404).json({ error: "On Rent entry not found." });
    return;
  }

  const removeUnit = onRentOrder.assignedUnits.find(
    (unit) => unit.unitId === removeUnitId,
  );
  if (!removeUnit) {
    res.status(400).json({
      error: "Selected unit to remove is not assigned to this On Rent entry.",
    });
    return;
  }

  const addUnit = await prisma.inventory.findUnique({
    where: { unitNumber: addUnitNumber },
    include: { asset: true },
  });
  if (!addUnit) {
    res.status(404).json({ error: "Replacement unit not found." });
    return;
  }

  if (addUnit.id === removeUnit.unitId) {
    res.status(400).json({ error: "Replacement unit must be different from current unit." });
    return;
  }

  if (normalizeStatus(addUnit.status) !== STATUS_AVAILABLE) {
    res.status(400).json({ error: `Replacement unit must be ${STATUS_AVAILABLE}.` });
    return;
  }

  const swappedAt = new Date().toISOString();
  const updated = await swapOnRentUnit(
    id,
    removeUnitId,
    {
      unitId: addUnit.id,
      unitNumber: addUnit.unitNumber,
      type: addUnit.asset.type,
    },
    swappedAt,
  );
  if (!updated) {
    res.status(400).json({ error: "Unable to swap unit for this On Rent entry." });
    return;
  }

  await prisma.inventory.updateMany({
    where: { id: { in: [removeUnitId] } },
    data: { status: STATUS_DOWN },
  });
  await prisma.inventory.updateMany({
    where: { id: { in: [addUnit.id] } },
    data: { status: STATUS_ON_RENT, inspectionRequired: false },
  });
  await evaluateMaintenanceRulesForUnits([removeUnitId, addUnit.id]);

  res.json({
    ok: true,
    updated,
    swapped: {
      fromUnitNumber: removeUnit.unitNumber,
      toUnitNumber: addUnit.unitNumber,
      reason,
    },
  });
});

function parseSwapUnitId(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

apiReservationsRouter.post("/:id/swap-unit", async (req, res) => {
  const { id } = req.params;
  const body = req.body as Record<string, unknown>;
  const removeUnitId = parseSwapUnitId(body.removeUnitId);
  const addUnitId = parseSwapUnitId(body.addUnitId);

  if (!removeUnitId || !addUnitId) {
    res.status(400).json({ error: "removeUnitId and addUnitId are required." });
    return;
  }

  const snapshot = await getReservationsSnapshot();
  const reservation = snapshot.reservations.find((r) => r.id === id);
  if (!reservation) {
    res.status(404).json({ error: "Reservation not found." });
    return;
  }

  const removeUnit = reservation.assignedUnits.find((u) => u.unitId === removeUnitId);
  if (!removeUnit) {
    res.status(400).json({ error: "Selected unit to remove is not assigned to this reservation." });
    return;
  }

  const addUnit = await prisma.inventory.findUnique({
    where: { id: addUnitId },
    include: { asset: true },
  });
  if (!addUnit) {
    res.status(404).json({ error: "Replacement unit not found." });
    return;
  }
  if (normalizeStatus(addUnit.status) !== STATUS_AVAILABLE) {
    res.status(400).json({ error: `Replacement unit must be ${STATUS_AVAILABLE}.` });
    return;
  }

  const updated = await swapReservationUnit(id, removeUnitId, {
    unitId: addUnit.id,
    unitNumber: addUnit.unitNumber,
    type: addUnit.asset.type,
  });
  if (!updated) {
    res.status(400).json({ error: "Unable to swap unit for this reservation." });
    return;
  }

  await prisma.inventory.updateMany({
    where: { id: { in: [removeUnitId] } },
    data: { status: STATUS_AVAILABLE, inspectionRequired: false },
  });
  await prisma.inventory.updateMany({
    where: { id: { in: [addUnitId] } },
    data: { status: STATUS_RESERVED, inspectionRequired: false },
  });
  await evaluateMaintenanceRulesForUnits([removeUnitId, addUnitId]);

  res.json(updated);
});

apiReservationsRouter.post("/:id/cancel", async (req, res) => {
  const { id } = req.params;
  const canceled = await cancelReservation(id);
  if (!canceled) {
    res.status(404).json({ error: "Reservation not found." });
    return;
  }

  await prisma.inventory.updateMany({
    where: { id: { in: canceled.assignedUnits.map((u) => u.unitId) } },
    data: { status: STATUS_AVAILABLE, inspectionRequired: false },
  });
  await evaluateMaintenanceRulesForUnits(canceled.assignedUnits.map((u) => u.unitId));

  res.json({ ok: true });
});

apiReservationsRouter.post("/:id/potential", async (req, res) => {
  const { id } = req.params;
  const potential = await moveReservationToPotential(id);
  if (!potential) {
    res.status(404).json({ error: "Reservation not found." });
    return;
  }

  await prisma.inventory.updateMany({
    where: { id: { in: potential.assignedUnits.map((u) => u.unitId) } },
    data: { status: STATUS_AVAILABLE, inspectionRequired: false },
  });
  await evaluateMaintenanceRulesForUnits(potential.assignedUnits.map((u) => u.unitId));

  res.json({ ok: true });
});

apiReservationsRouter.post("/:id/convert-to-reservation", async (req, res) => {
  const { id } = req.params;
  const converted = await convertPotentialToReservation(id);
  if (!converted) {
    res.status(404).json({ error: "Potential entry not found." });
    return;
  }
  res.json({ ok: true, reservation: converted });
});

apiReservationsRouter.delete("/:id/potential", async (req, res) => {
  const { id } = req.params;
  const deleted = await deletePotential(id);
  if (!deleted) {
    res.status(404).json({ error: "Potential entry not found." });
    return;
  }
  res.json({ ok: true });
});
