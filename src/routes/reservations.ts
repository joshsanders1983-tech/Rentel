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

async function buildShortageMessage(input: {
  type: string;
  quantity: number;
  assignedCount: number;
  shortBy: number;
}) {
  const snapshot = await getReservationsSnapshot();
  const targetType = upperText(input.type);

  const matchingReturnTimes: Date[] = [];
  for (const order of snapshot.onRent) {
    const hasMatchingUnit = (order.assignedUnits || []).some(
      (u) => upperText(u.type) === targetType,
    );
    if (!hasMatchingUnit) continue;
    const dt = parseLocalDateTime(order.endDate, order.endTime);
    if (dt) matchingReturnTimes.push(dt);
  }
  matchingReturnTimes.sort((a, b) => a.getTime() - b.getTime());

  const base = `Not enough ${STATUS_AVAILABLE} units for type "${input.type}". Requested ${input.quantity}, currently assignable ${input.assignedCount}. Short by ${input.shortBy} unit(s).`;

  if (matchingReturnTimes.length === 0) {
    return `${base} No matching On Rent return time is currently scheduled.`;
  }

  if (matchingReturnTimes.length >= input.shortBy) {
    const fulfillment = matchingReturnTimes[input.shortBy - 1]!;
    return `${base} Expected fulfillment by ${fulfillment.toLocaleString()} based on current On Rent end times.`;
  }

  const earliest = matchingReturnTimes[0]!;
  const stillShort = input.shortBy - matchingReturnTimes.length;
  return `${base} Only ${matchingReturnTimes.length} matching return(s) are currently scheduled (earliest ${earliest.toLocaleString()}); still short by ${stillShort} after those returns.`;
}

apiReservationsRouter.get("/", async (_req, res) => {
  res.json(await getReservationsSnapshot());
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
  const type = typeof body.type === "string" ? body.type.trim() : "";
  const quantityRaw = Number(body.quantity);
  const quantity = Number.isFinite(quantityRaw) ? Math.trunc(quantityRaw) : 0;
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
    !type ||
    quantity < 1
  ) {
    res.status(400).json({
      error:
        "customerName, address, startDate, startTime, endDate, endTime, type, and quantity are required.",
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
  if (manualUnits.length > quantity) {
    res.status(400).json({ error: "Manual unit selection exceeds reservation quantity." });
    return;
  }

  const lastRentedByUnit = await getLastRentedByUnit();
  const manualSet = new Set(manualUnits.map((u) => u.id));
  const targetType = upperText(type);

  const matchingAuto = available
    .filter((u) => !manualSet.has(u.id))
    .filter((u) => upperText(u.asset.type) === targetType)
    .sort((a, b) => {
      const aLast = lastRentedByUnit[a.id];
      const bLast = lastRentedByUnit[b.id];
      if (!aLast && !bLast) {
        return a.createdAt.getTime() - b.createdAt.getTime();
      }
      if (!aLast) return -1;
      if (!bLast) return 1;
      return new Date(aLast).getTime() - new Date(bLast).getTime();
    });

  const needed = quantity - manualUnits.length;
  const autoUnits = matchingAuto.slice(0, needed);
  const assigned = [...manualUnits, ...autoUnits];

  if (assigned.length < quantity) {
    const shortBy = quantity - assigned.length;
    res.status(400).json({
      error: await buildShortageMessage({
        type,
        quantity,
        assignedCount: assigned.length,
        shortBy,
      }),
    });
    return;
  }

  const assignedIds = assigned.map((u) => u.id);
  await prisma.inventory.updateMany({
    where: { id: { in: assignedIds } },
    data: { status: STATUS_RESERVED, inspectionRequired: false },
  });

  const reservation = await addReservation({
    customerName,
    address,
    startDate,
    startTime,
    endDate,
    endTime,
    type,
    quantity,
    assignedUnits: assigned.map((u) => ({
      unitId: u.id,
      unitNumber: u.unitNumber,
      type: u.asset.type,
    })),
    groupKey: reservationGroupKey({
      customerName,
      address,
      startDate,
      startTime,
      endDate,
      endTime,
    }),
  });

  res.status(201).json(reservation);
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
  const removeUnitId =
    typeof body.removeUnitId === "string" ? body.removeUnitId.trim() : "";
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
