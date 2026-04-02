import { Router } from "express";
import { requireAdmin } from "../lib/adminAuth.js";
import {
  completeOpenMaintenanceTasksForInventory,
  evaluateMaintenanceRulesForUnits,
  isServiceDueReason,
} from "../lib/maintenanceAutomation.js";
import { prisma } from "../lib/prisma.js";
import {
  appendRepairHistoryEntry,
  getRepairHistoryEntries,
} from "../lib/repairHistory.js";
import {
  appendServiceHistoryEntry,
  getServiceHistoryEntries,
} from "../lib/serviceHistory.js";
import {
  getInventoryCachePayloadIfFresh,
  invalidateInventoryCache,
  setInventoryCachePayload,
} from "../lib/inventoryCache.js";
import { normalizeStatus } from "../lib/statusFormat.js";
import { getTechSession, requireTech } from "../lib/techAuth.js";

export const apiInventoryRouter = Router();
const DEFAULT_NEW_UNIT_STATUS = "Available";

function upperText(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

function isReturnedStatus(value: unknown) {
  return upperText(value).startsWith("RETURN");
}

function isAvailableStatus(value: unknown) {
  return upperText(value) === "AVAILABLE";
}

function isDownStatus(value: unknown) {
  return upperText(value).startsWith("DOWN");
}

function deriveDownReason(row: {
  downReason?: string | null;
  inspectionSubmissions?: Array<{
    itemResults?: Array<{
      selectedNeedsAttention: boolean;
      selectedDamaged: boolean;
    }>;
  }>;
}) {
  const latestSubmission = Array.isArray(row.inspectionSubmissions)
    ? row.inspectionSubmissions[0]
    : null;
  if (!latestSubmission || !Array.isArray(latestSubmission.itemResults)) {
    return null;
  }

  const hasNeedsAttention = latestSubmission.itemResults.some(
    (result) => result.selectedNeedsAttention,
  );
  const hasDamaged = latestSubmission.itemResults.some(
    (result) => result.selectedDamaged,
  );

  if (hasDamaged && hasNeedsAttention) return "Damaged, Needs attention";
  if (hasDamaged) return "Damaged";
  if (hasNeedsAttention) return "Needs attention";
  return null;
}

type ParsedHoursField =
  | { valid: true; hasValue: boolean; value: number | null }
  | { valid: false; error: string };

function parseHoursField(body: Record<string, unknown>): ParsedHoursField {
  const hasHours = Object.prototype.hasOwnProperty.call(body, "hours");
  if (!hasHours) {
    return { valid: true, hasValue: false, value: null };
  }

  const rawHours = body.hours;
  if (rawHours === null) {
    return { valid: true, hasValue: true, value: null };
  }

  if (typeof rawHours === "string" && rawHours.trim() === "") {
    return { valid: true, hasValue: true, value: null };
  }

  const parsed = Number(rawHours);
  if (!Number.isFinite(parsed)) {
    return { valid: false, error: "Hours must be a valid number." };
  }

  return { valid: true, hasValue: true, value: Number(parsed) };
}

type ParsedDownReasonField =
  | { valid: true; hasValue: boolean; value: string | null }
  | { valid: false; error: string };

function parseDownReasonField(
  body: Record<string, unknown>,
): ParsedDownReasonField {
  const hasReason = Object.prototype.hasOwnProperty.call(body, "downReason");
  if (!hasReason) {
    return { valid: true, hasValue: false, value: null };
  }

  const rawReason = body.downReason;
  if (rawReason === null) {
    return { valid: true, hasValue: true, value: null };
  }
  if (typeof rawReason !== "string") {
    return { valid: false, error: "Reason must be text." };
  }

  const trimmed = rawReason.trim();
  return { valid: true, hasValue: true, value: trimmed || null };
}

type CompleteRepairPartLine = { partNumber: string; qty: number };

function parseCompleteRepairParts(body: Record<string, unknown>): CompleteRepairPartLine[] | null {
  const raw = body.parts;
  if (!Array.isArray(raw) || raw.length === 0) {
    return null;
  }
  const out: CompleteRepairPartLine[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      return null;
    }
    const rec = item as Record<string, unknown>;
    const partNumber =
      typeof rec.partNumber === "string" ? rec.partNumber.trim() : "";
    const qty = Number(rec.qty);
    if (!partNumber) {
      return null;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      return null;
    }
    out.push({ partNumber, qty });
  }
  return out.length > 0 ? out : null;
}

function formatCompleteRepairDetails(input: {
  unitNumber: string;
  assetType: string | null;
  assetDescription: string | null;
  workPerformed: string;
  parts: CompleteRepairPartLine[];
  priorDownReason: string | null;
}): string {
  const header = `Unit: ${input.unitNumber} · ${input.assetType ?? "—"} · ${input.assetDescription ?? "—"}`;
  const partsLine = input.parts.map((p) => `${p.partNumber} × ${p.qty}`).join("; ");
  const lines = [header, "", `Work performed: ${input.workPerformed}`, `Parts: ${partsLine}`];
  if (input.priorDownReason) {
    lines.push(`Prior down reason: ${input.priorDownReason}`);
  }
  return lines.join("\n");
}

apiInventoryRouter.get("/", async (_req, res) => {
  const cached = getInventoryCachePayloadIfFresh();
  if (cached) {
    res.json(cached);
    return;
  }
  const rows = await prisma.inventory.findMany({
    include: {
      asset: true,
      inspectionSubmissions: {
        orderBy: { submittedAt: "desc" },
        take: 1,
        select: {
          itemResults: {
            select: {
              selectedNeedsAttention: true,
              selectedDamaged: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  const payload = rows.map((row) => ({
    ...row,
    status: normalizeStatus(row.status),
    downReason:
      (row as unknown as { downReason?: string | null }).downReason ??
      deriveDownReason(row),
  }));
  setInventoryCachePayload(payload);
  res.json(payload);
});

apiInventoryRouter.post("/", requireAdmin, async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const assetId = typeof body.assetId === "string" ? body.assetId : "";
  const unitNumber =
    typeof body.unitNumber === "string" ? body.unitNumber.trim() : "";
  const parsedHours = parseHoursField(body);
  const status = DEFAULT_NEW_UNIT_STATUS;

  if (!assetId || !unitNumber) {
    res.status(400).json({ error: "Invalid body: assetId and unitNumber are required." });
    return;
  }
  if (!parsedHours.valid) {
    res.status(400).json({ error: parsedHours.error });
    return;
  }

  // Ensure the asset exists.
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) {
    res.status(400).json({ error: "Asset not found." });
    return;
  }
  if (!asset.active) {
    res.status(400).json({ error: "Selected asset type is inactive." });
    return;
  }

  try {
    const created = await prisma.inventory.create({
      data: {
        assetId,
        unitNumber,
        hours: parsedHours.hasValue ? parsedHours.value : null,
        status,
        downReason: null,
        inspectionRequired: false,
        lastInspectionCompletedAt: null,
      },
      include: { asset: true },
    });

    await evaluateMaintenanceRulesForUnits([created.id]);
    const hydrated = await prisma.inventory.findUnique({
      where: { id: created.id },
      include: { asset: true },
    });
    invalidateInventoryCache();
    res.status(201).json(hydrated || created);
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      res.status(409).json({ error: "That unit number already exists." });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to create inventory unit." });
  }
});

apiInventoryRouter.patch("/:id", requireAdmin, async (req, res) => {
  const id = typeof req.params.id === "string" ? req.params.id : "";
  if (!id) {
    res.status(400).json({ error: "Invalid inventory id." });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const assetIdInput =
    typeof body.assetId === "string" ? body.assetId.trim() : "";
  const unitNumber =
    typeof body.unitNumber === "string" ? body.unitNumber.trim() : "";
  const statusInput = normalizeStatus(body.status);
  const parsedHours = parseHoursField(body);
  const parsedDownReason = parseDownReasonField(body);
  if (!parsedHours.valid) {
    res.status(400).json({ error: parsedHours.error });
    return;
  }
  if (!parsedDownReason.valid) {
    res.status(400).json({ error: parsedDownReason.error });
    return;
  }

  const existing = await prisma.inventory.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: "Inventory unit not found." });
    return;
  }

  const assetId = assetIdInput || existing.assetId;
  const nextUnitNumber = unitNumber || existing.unitNumber;
  const status = statusInput || normalizeStatus(existing.status);
  if (!assetId || !nextUnitNumber || !status) {
    res.status(400).json({ error: "Invalid update payload." });
    return;
  }

  const existingReturned = isReturnedStatus(existing.status);
  const currentlyInspectionLocked = existing.inspectionRequired || existingReturned;

  if (isAvailableStatus(status) && currentlyInspectionLocked) {
    res.status(400).json({
      error: "Inspection form must be completed before setting this unit to Available.",
    });
    return;
  }

  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) {
    res.status(400).json({ error: "Asset not found." });
    return;
  }
  if (!asset.active) {
    res.status(400).json({ error: "Selected asset type is inactive." });
    return;
  }

  const returningNow = isReturnedStatus(status);
  const preservingInspectionLock =
    !returningNow && !isAvailableStatus(status) && currentlyInspectionLocked;
  const movingToDown = isDownStatus(status);

  try {
    const updated = await prisma.inventory.update({
      where: { id },
      data: {
        assetId,
        unitNumber: nextUnitNumber,
        ...(parsedHours.hasValue ? { hours: parsedHours.value } : {}),
        status,
        downReason: movingToDown
          ? parsedDownReason.hasValue
            ? parsedDownReason.value
            : (existing as unknown as { downReason?: string | null }).downReason ?? null
          : null,
        ...(returningNow
          ? {
              inspectionRequired: true,
              lastInspectionCompletedAt: null,
            }
          : {}),
        ...(preservingInspectionLock
          ? {
              inspectionRequired: true,
            }
          : {}),
      },
      include: { asset: true },
    });
    if (movingToDown && !isDownStatus(existing.status)) {
      await appendRepairHistoryEntry({
        inventoryId: updated.id,
        action: "DOWN",
        details:
          parsedDownReason.hasValue && parsedDownReason.value
            ? parsedDownReason.value
            : "Moved to Down from Inventory.",
      });
    }
    if (isAvailableStatus(status) && isDownStatus(existing.status)) {
      await appendRepairHistoryEntry({
        inventoryId: updated.id,
        action: "COMPLETE",
        details: "Moved to Available from Down in Inventory.",
        repairHours:
          parsedHours.hasValue && parsedHours.value !== null
            ? parsedHours.value
            : existing.hours,
      });
    }
    await evaluateMaintenanceRulesForUnits([updated.id]);
    const hydrated = await prisma.inventory.findUnique({
      where: { id: updated.id },
      include: { asset: true },
    });
    invalidateInventoryCache();
    res.json(hydrated || updated);
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      res.status(409).json({ error: "That unit number already exists." });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to update inventory unit." });
  }
});

apiInventoryRouter.post("/manual-down", requireTech, async (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    const techNameInput =
      typeof body.techName === "string" ? body.techName.trim() : "";
    const actorName = techNameInput || getTechSession(req)?.techName || "";
    const unitNumber =
      typeof body.unitNumber === "string" ? body.unitNumber.trim() : "";
    const reason =
      typeof body.reason === "string" ? body.reason.trim() : "";
    const hours = Number(body.hours);
    const downReason = actorName ? `${reason} (Tech: ${actorName})` : reason;

    if (!unitNumber) {
      res.status(400).json({ error: "Unit # is required." });
      return;
    }
    if (!Number.isFinite(hours)) {
      res.status(400).json({ error: "Hours must be a valid number." });
      return;
    }
    if (hours < 0) {
      res.status(400).json({ error: "Hours cannot be negative." });
      return;
    }
    if (!reason) {
      res.status(400).json({ error: "Reason is required." });
      return;
    }

    const existing = await prisma.inventory.findUnique({
      where: { unitNumber },
      include: { asset: true },
    });
    if (!existing) {
      res.status(404).json({ error: `Unit ${unitNumber} was not found.` });
      return;
    }

    const updated = await prisma.inventory.update({
      where: { id: existing.id },
      data: {
        status: "Down",
        hours,
        downReason,
        inspectionRequired: false,
      },
      include: { asset: true },
    });

    // Non-critical side effects should not fail the user action after status update.
    try {
      await appendRepairHistoryEntry({
        inventoryId: updated.id,
        action: "DOWN",
        details: downReason || "Moved to Down.",
        techName: actorName || null,
      });
      await evaluateMaintenanceRulesForUnits([updated.id]);
    } catch (err) {
      console.error("[inventory] manual-down side effect failed:", err);
    }

    const hydrated = await prisma.inventory.findUnique({
      where: { id: updated.id },
      include: { asset: true },
    });
    const row = hydrated || updated;
    invalidateInventoryCache();

    res.json({
      ...row,
      status: normalizeStatus(row.status),
    });
  } catch (err) {
    console.error("[inventory] POST /manual-down failed:", err);
    res.status(500).json({ error: "Failed to move unit to Down." });
  }
});

apiInventoryRouter.post("/:id/complete", requireTech, async (req, res) => {
  try {
    const id = typeof req.params.id === "string" ? req.params.id.trim() : "";
    if (!id) {
      res.status(400).json({ error: "Invalid inventory id." });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const techSession = getTechSession(req);
    const actorName =
      (techSession?.techName && String(techSession.techName).trim()) ||
      (techSession?.username && String(techSession.username).trim()) ||
      "";
    const repairHours = Number(body.hours);
    const laborHours = Number(body.laborHours);
    const workPerformed =
      typeof body.workPerformed === "string" ? body.workPerformed.trim() : "";

    if (!Number.isFinite(repairHours)) {
      res.status(400).json({ error: "Current unit hours is required and must be a valid number." });
      return;
    }
    if (repairHours < 0) {
      res.status(400).json({ error: "Current unit hours cannot be negative." });
      return;
    }
    if (!Number.isFinite(laborHours)) {
      res.status(400).json({ error: "Labor hours is required and must be a valid number." });
      return;
    }
    if (laborHours < 0) {
      res.status(400).json({ error: "Labor hours cannot be negative." });
      return;
    }
    if (!workPerformed) {
      res.status(400).json({ error: "Work performed is required." });
      return;
    }

    const parts = parseCompleteRepairParts(body);
    if (!parts) {
      res.status(400).json({
        error:
          "Add at least one part line with Part # (use \"None\" if no parts) and a quantity greater than zero.",
      });
      return;
    }

    const existing = await prisma.inventory.findUnique({
      where: { id },
      include: { asset: true },
    });
    if (!existing) {
      res.status(404).json({ error: "Inventory unit not found." });
      return;
    }
    if (!isDownStatus(existing.status)) {
      res.status(400).json({ error: "Unit must be Down before it can be completed." });
      return;
    }
    if (existing.hours !== null && repairHours < existing.hours) {
      res.status(400).json({
        error: `Current unit hours must be greater than or equal to ${existing.hours} (the unit's recorded hours).`,
      });
      return;
    }

    const completedAt = new Date();
    const updated = await prisma.inventory.update({
      where: { id: existing.id },
      data: {
        status: "Available",
        hours: repairHours,
        downReason: null,
        inspectionRequired: false,
        lastInspectionCompletedAt: completedAt,
      },
      include: { asset: true },
    });

    const repairDetails = formatCompleteRepairDetails({
      unitNumber: existing.unitNumber,
      assetType: existing.asset?.type ?? null,
      assetDescription: existing.asset?.description ?? null,
      workPerformed,
      parts,
      priorDownReason: existing.downReason ?? null,
    });

    // Non-critical side effects should not fail the complete action response.
    try {
      await appendRepairHistoryEntry({
        inventoryId: updated.id,
        action: "COMPLETE",
        details: repairDetails,
        techName: actorName || null,
        repairHours,
        laborHours,
        createdAt: completedAt,
      });

      if (isServiceDueReason(existing.downReason)) {
        await appendServiceHistoryEntry({
          inventoryId: updated.id,
          details: existing.downReason
            ? `Completed service: ${existing.downReason}`
            : "Completed scheduled service.",
          techName: actorName || null,
          repairHours,
          createdAt: completedAt,
        });
      }

      await completeOpenMaintenanceTasksForInventory(updated.id, completedAt.toISOString());
      await evaluateMaintenanceRulesForUnits([updated.id]);
    } catch (err) {
      console.error("[inventory] complete side effect failed:", err);
    }

    const hydrated = await prisma.inventory.findUnique({
      where: { id: updated.id },
      include: { asset: true },
    });
    const row = hydrated || updated;
    invalidateInventoryCache();

    res.json({
      ...row,
      status: normalizeStatus(row.status),
    });
  } catch (err) {
    console.error("[inventory] POST /:id/complete failed:", err);
    res.status(500).json({ error: "Failed to complete unit." });
  }
});

apiInventoryRouter.get("/:id/repair-history", requireTech, async (req, res) => {
  try {
    const id = typeof req.params.id === "string" ? req.params.id.trim() : "";
    if (!id) {
      res.status(400).json({ error: "Invalid inventory id." });
      return;
    }

    const inventory = await prisma.inventory.findUnique({
      where: { id },
      include: { asset: true },
    });
    if (!inventory) {
      res.status(404).json({ error: "Inventory unit not found." });
      return;
    }

    const entries = await getRepairHistoryEntries(id, 200);
    res.json({
      inventoryId: inventory.id,
      unitNumber: inventory.unitNumber,
      assetType: inventory.asset?.type ?? null,
      entries,
    });
  } catch (err) {
    console.error("[inventory] GET /:id/repair-history failed:", err);
    res.status(500).json({ error: "Failed to load repair history." });
  }
});

apiInventoryRouter.get("/:id/service-history", requireTech, async (req, res) => {
  const id = typeof req.params.id === "string" ? req.params.id.trim() : "";
  try {
    if (!id) {
      res.status(400).json({ error: "Invalid inventory id." });
      return;
    }

    const inventory = await prisma.inventory.findUnique({
      where: { id },
      include: { asset: true },
    });
    if (!inventory) {
      res.status(404).json({ error: "Inventory unit not found." });
      return;
    }

    const entries = await getServiceHistoryEntries(id, 200);
    res.json({
      inventoryId: inventory.id,
      unitNumber: inventory.unitNumber,
      assetType: inventory.asset?.type ?? null,
      entries,
    });
  } catch (err) {
    console.error("[inventory] GET /:id/service-history failed:", err);
    // Keep Unit History usable even when service-history storage is not ready.
    res.json({
      inventoryId: id,
      unitNumber: null,
      assetType: null,
      entries: [],
    });
  }
});

apiInventoryRouter.get("/:id/inspection-history", requireTech, async (req, res) => {
  try {
    const id = typeof req.params.id === "string" ? req.params.id.trim() : "";
    if (!id) {
      res.status(400).json({ error: "Invalid inventory id." });
      return;
    }

    const inventory = await prisma.inventory.findUnique({
      where: { id },
      include: { asset: true },
    });
    if (!inventory) {
      res.status(404).json({ error: "Inventory unit not found." });
      return;
    }

    const submissions = await prisma.inspectionSubmission.findMany({
      where: { inventoryId: id },
      orderBy: { submittedAt: "desc" },
      take: 200,
      select: {
        id: true,
        submittedAt: true,
        hourMeterReading: true,
        submittedByTechName: true,
      },
    });

    const entries = submissions.map((sub) => ({
      id: sub.id,
      submittedAt: sub.submittedAt.toISOString(),
      hourMeterReading:
        typeof sub.hourMeterReading === "number" && Number.isFinite(sub.hourMeterReading)
          ? sub.hourMeterReading
          : null,
      submittedByTechName: sub.submittedByTechName ?? null,
    }));

    res.json({
      inventoryId: inventory.id,
      unitNumber: inventory.unitNumber,
      assetType: inventory.asset?.type ?? null,
      entries,
    });
  } catch (err) {
    console.error("[inventory] GET /:id/inspection-history failed:", err);
    res.status(500).json({ error: "Failed to load inspection history." });
  }
});

apiInventoryRouter.delete("/:id", requireAdmin, async (req, res) => {
  const id = typeof req.params.id === "string" ? req.params.id : "";
  if (!id) {
    res.status(400).json({ error: "Invalid inventory id." });
    return;
  }
  const existing = await prisma.inventory.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: "Inventory unit not found." });
    return;
  }

  await prisma.inventory.delete({ where: { id } });
  invalidateInventoryCache();
  res.status(204).send();
});

