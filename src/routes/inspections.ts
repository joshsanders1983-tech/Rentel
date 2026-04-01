import { Router } from "express";
import { requireAdmin } from "../lib/adminAuth.js";
import { getCurrentInventoryHours } from "../lib/inspectionHours.js";
import {
  completeOpenMaintenanceTasksForInspection,
  evaluateMaintenanceRulesForUnits,
  type InventoryServiceStateOptions,
} from "../lib/maintenanceAutomation.js";
import { prisma } from "../lib/prisma.js";
import { invalidateInventoryCache } from "../lib/inventoryCache.js";
import { appendRepairHistoryEntry } from "../lib/repairHistory.js";
import { removeReturnedOnRentUnit } from "../lib/reservationsState.js";
import { normalizeStatus } from "../lib/statusFormat.js";
import { getTechSession, requireTech } from "../lib/techAuth.js";

export const apiInspectionsRouter = Router();

const STATUS_AVAILABLE = "Available";
const STATUS_DOWN = "Down";
const DEFAULT_FORM_NAME = "Default Inspection Form";
const EMPTY_OPTIONS = {
  ok: false,
  needsAttention: false,
  damaged: false,
  na: false,
};
const DEFAULT_OPTIONS = {
  ok: true,
  needsAttention: true,
  damaged: true,
  na: true,
};

type InspectionOptions = typeof EMPTY_OPTIONS;

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

function formItemOptions(item: {
  allowOk: boolean;
  allowNeedsAttention: boolean;
  allowDamaged: boolean;
  allowNa: boolean;
}): InspectionOptions {
  return {
    ok: item.allowOk,
    needsAttention: item.allowNeedsAttention,
    damaged: item.allowDamaged,
    na: item.allowNa,
  };
}

function hasAnyOption(options: InspectionOptions) {
  return options.ok || options.needsAttention || options.damaged || options.na;
}

function selectedOptionCount(options: InspectionOptions) {
  return (
    Number(options.ok) +
    Number(options.needsAttention) +
    Number(options.damaged) +
    Number(options.na)
  );
}

function hasDisallowedSelection(
  selected: InspectionOptions,
  allowed: InspectionOptions,
) {
  return (
    (selected.ok && !allowed.ok) ||
    (selected.needsAttention && !allowed.needsAttention) ||
    (selected.damaged && !allowed.damaged) ||
    (selected.na && !allowed.na)
  );
}

function parseInspectionOptions(
  raw: unknown,
  fallback: InspectionOptions,
): InspectionOptions {
  if (!raw || typeof raw !== "object") {
    return fallback;
  }
  const record = raw as Record<string, unknown>;
  const parseBool = (key: keyof InspectionOptions) => {
    const value = record[key];
    if (value === true) return true;
    if (value === false) return false;
    return fallback[key];
  };
  return {
    ok: parseBool("ok"),
    needsAttention: parseBool("needsAttention"),
    damaged: parseBool("damaged"),
    na: parseBool("na"),
  };
}

async function getOrCreateDefaultForm() {
  const existing = await prisma.inspectionForm.findFirst({
    orderBy: { createdAt: "asc" },
  });
  if (existing) {
    return existing;
  }
  return prisma.inspectionForm.create({
    data: {
      name: DEFAULT_FORM_NAME,
      active: true,
      requireHourMeterEntry: false,
    },
  });
}

async function resolveFormForAsset(assetId: string) {
  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    include: { inspectionForm: true },
  });
  if (!asset) {
    return null;
  }

  if (asset.inspectionForm && asset.inspectionForm.active) {
    return asset.inspectionForm;
  }

  const fallbackForm = await getOrCreateDefaultForm();
  if (!asset.inspectionFormId || asset.inspectionForm?.active === false) {
    await prisma.asset.update({
      where: { id: asset.id },
      data: { inspectionFormId: fallbackForm.id },
    });
  }
  return fallbackForm;
}

apiInspectionsRouter.get("/config", async (_req, res) => {
  const form = await getOrCreateDefaultForm();
  res.json({
    id: "default",
    formId: form.id,
    formName: form.name,
    requireHourMeterEntry: form.requireHourMeterEntry,
  });
});

apiInspectionsRouter.patch("/config", requireAdmin, async (req, res) => {
  const body = req.body as Record<string, unknown>;
  if (typeof body.requireHourMeterEntry !== "boolean") {
    res.status(400).json({ error: "requireHourMeterEntry must be a boolean." });
    return;
  }
  const form = await getOrCreateDefaultForm();
  const updated = await prisma.inspectionForm.update({
    where: { id: form.id },
    data: { requireHourMeterEntry: body.requireHourMeterEntry },
  });
  res.json({
    id: "default",
    formId: updated.id,
    formName: updated.name,
    requireHourMeterEntry: updated.requireHourMeterEntry,
  });
});

apiInspectionsRouter.get("/forms", async (req, res) => {
  const includeInactive =
    typeof req.query.includeInactive === "string" &&
    req.query.includeInactive.trim() === "1";

  await getOrCreateDefaultForm();
  const rows = await prisma.inspectionForm.findMany({
    ...(includeInactive ? {} : { where: { active: true } }),
    orderBy: [{ createdAt: "asc" }],
    include: {
      _count: {
        select: {
          items: true,
          assets: true,
        },
      },
    },
  });

  res.json(
    rows.map((row) => ({
      ...row,
      itemCount: row._count.items,
      assignedAssetTypeCount: row._count.assets,
    })),
  );
});

apiInspectionsRouter.post("/forms", requireAdmin, async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const requireHourMeterEntry =
    typeof body.requireHourMeterEntry === "boolean"
      ? body.requireHourMeterEntry
      : false;

  if (!name) {
    res.status(400).json({ error: "Inspection form name is required." });
    return;
  }

  const created = await prisma.inspectionForm.create({
    data: {
      name,
      active: true,
      requireHourMeterEntry,
    },
  });
  res.status(201).json(created);
});

apiInspectionsRouter.patch("/forms/:id", requireAdmin, async (req, res) => {
  const id = typeof req.params.id === "string" ? req.params.id : "";
  if (!id) {
    res.status(400).json({ error: "Invalid inspection form id." });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const nextName = typeof body.name === "string" ? body.name.trim() : null;
  const nextActive = typeof body.active === "boolean" ? body.active : undefined;
  const nextRequireHours =
    typeof body.requireHourMeterEntry === "boolean"
      ? body.requireHourMeterEntry
      : undefined;

  if (nextName !== null && !nextName) {
    res.status(400).json({ error: "Inspection form name cannot be empty." });
    return;
  }
  if (
    nextName === null &&
    typeof nextActive !== "boolean" &&
    typeof nextRequireHours !== "boolean"
  ) {
    res.status(400).json({ error: "Nothing to update." });
    return;
  }

  const existing = await prisma.inspectionForm.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: "Inspection form not found." });
    return;
  }

  if (nextActive === false) {
    const activeCount = await prisma.inspectionForm.count({
      where: { active: true },
    });
    if (activeCount <= 1 && existing.active) {
      res.status(400).json({
        error: "At least one active inspection form is required.",
      });
      return;
    }
  }

  const updated = await prisma.inspectionForm.update({
    where: { id },
    data: {
      ...(nextName !== null ? { name: nextName } : {}),
      ...(typeof nextActive === "boolean" ? { active: nextActive } : {}),
      ...(typeof nextRequireHours === "boolean"
        ? { requireHourMeterEntry: nextRequireHours }
        : {}),
    },
  });

  res.json(updated);
});

apiInspectionsRouter.delete("/forms/:id", requireAdmin, async (req, res) => {
  const id = typeof req.params.id === "string" ? req.params.id : "";
  if (!id) {
    res.status(400).json({ error: "Invalid inspection form id." });
    return;
  }

  const existing = await prisma.inspectionForm.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          assets: true,
        },
      },
    },
  });
  if (!existing) {
    res.status(404).json({ error: "Inspection form not found." });
    return;
  }

  const totalForms = await prisma.inspectionForm.count();
  if (totalForms <= 1) {
    res.status(400).json({ error: "At least one inspection form is required." });
    return;
  }
  if (existing._count.assets > 0) {
    res.status(400).json({
      error:
        "This form is assigned to one or more asset types. Reassign those asset types first.",
    });
    return;
  }

  await prisma.inspectionForm.delete({ where: { id } });
  res.status(204).send();
});

apiInspectionsRouter.get("/asset-mappings", async (_req, res) => {
  await getOrCreateDefaultForm();
  const assets = await prisma.asset.findMany({
    where: { active: true },
    orderBy: [{ type: "asc" }, { createdAt: "asc" }],
    include: {
      inspectionForm: true,
    },
  });

  res.json(
    assets.map((asset) => ({
      assetId: asset.id,
      type: asset.type,
      description: asset.description,
      inspectionFormId: asset.inspectionFormId,
      inspectionForm: asset.inspectionForm,
    })),
  );
});

apiInspectionsRouter.patch("/asset-mappings/:assetId", requireAdmin, async (req, res) => {
  const assetId = typeof req.params.assetId === "string" ? req.params.assetId : "";
  if (!assetId) {
    res.status(400).json({ error: "Invalid asset id." });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const formId = typeof body.formId === "string" ? body.formId.trim() : "";
  if (!formId) {
    res.status(400).json({ error: "formId is required." });
    return;
  }

  const [asset, form] = await Promise.all([
    prisma.asset.findUnique({ where: { id: assetId } }),
    prisma.inspectionForm.findUnique({ where: { id: formId } }),
  ]);
  if (!asset) {
    res.status(404).json({ error: "Asset type not found." });
    return;
  }
  if (!form) {
    res.status(404).json({ error: "Inspection form not found." });
    return;
  }
  if (!form.active) {
    res.status(400).json({ error: "Cannot assign an inactive inspection form." });
    return;
  }

  const updated = await prisma.asset.update({
    where: { id: asset.id },
    data: { inspectionFormId: form.id },
    include: { inspectionForm: true },
  });

  res.json({
    assetId: updated.id,
    type: updated.type,
    description: updated.description,
    inspectionFormId: updated.inspectionFormId,
    inspectionForm: updated.inspectionForm,
  });
});

apiInspectionsRouter.get("/form-items", async (req, res) => {
  const requestedFormId = typeof req.query.formId === "string" ? req.query.formId.trim() : "";
  const formId = requestedFormId || (await getOrCreateDefaultForm()).id;
  const includeInactive =
    typeof req.query.includeInactive === "string" &&
    req.query.includeInactive.trim() === "1";

  const rows = await prisma.inspectionFormItem.findMany({
    where: {
      formId,
      ...(includeInactive ? {} : { active: true }),
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  res.json(
    rows.map((row) => ({
      ...row,
      options: formItemOptions(row),
    })),
  );
});

apiInspectionsRouter.post("/form-items", requireAdmin, async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const requestedFormId = typeof body.formId === "string" ? body.formId.trim() : "";
  const formId = requestedFormId || (await getOrCreateDefaultForm()).id;
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label) {
    res.status(400).json({ error: "Inspection item label is required." });
    return;
  }
  const form = await prisma.inspectionForm.findUnique({ where: { id: formId } });
  if (!form) {
    res.status(404).json({ error: "Inspection form not found." });
    return;
  }

  const allowedOptions = parseInspectionOptions(body.options, DEFAULT_OPTIONS);
  if (!hasAnyOption(allowedOptions)) {
    res.status(400).json({
      error: "At least one response option is required (Ok, Needs attention, Damaged, or N/A).",
    });
    return;
  }

  const maxSort = await prisma.inspectionFormItem.aggregate({
    where: { formId },
    _max: { sortOrder: true },
  });
  const nextSortOrder = (maxSort._max.sortOrder ?? -1) + 1;

  const created = await prisma.inspectionFormItem.create({
    data: {
      formId,
      label,
      sortOrder: nextSortOrder,
      active: true,
      allowOk: allowedOptions.ok,
      allowNeedsAttention: allowedOptions.needsAttention,
      allowDamaged: allowedOptions.damaged,
      allowNa: allowedOptions.na,
    },
  });
  res.status(201).json({
    ...created,
    options: formItemOptions(created),
  });
});

apiInspectionsRouter.patch("/form-items/:id", requireAdmin, async (req, res) => {
  const id = typeof req.params.id === "string" ? req.params.id : "";
  if (!id) {
    res.status(400).json({ error: "Invalid inspection form item id." });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const nextLabel = typeof body.label === "string" ? body.label.trim() : null;
  const nextActive =
    typeof body.active === "boolean" ? body.active : undefined;
  const hasOptions = Object.prototype.hasOwnProperty.call(body, "options");

  if (nextLabel !== null && !nextLabel) {
    res.status(400).json({ error: "Inspection item label cannot be empty." });
    return;
  }

  const existing = await prisma.inspectionFormItem.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: "Inspection form item not found." });
    return;
  }
  const existingOptions = formItemOptions(existing);
  const nextOptions = hasOptions
    ? parseInspectionOptions(body.options, existingOptions)
    : null;
  if (nextLabel === null && typeof nextActive !== "boolean" && !nextOptions) {
    res.status(400).json({ error: "Nothing to update." });
    return;
  }
  if (nextOptions && !hasAnyOption(nextOptions)) {
    res.status(400).json({
      error: "At least one response option is required (Ok, Needs attention, Damaged, or N/A).",
    });
    return;
  }

  const updated = await prisma.inspectionFormItem.update({
    where: { id },
    data: {
      ...(nextLabel !== null ? { label: nextLabel } : {}),
      ...(typeof nextActive === "boolean" ? { active: nextActive } : {}),
      ...(nextOptions
        ? {
            allowOk: nextOptions.ok,
            allowNeedsAttention: nextOptions.needsAttention,
            allowDamaged: nextOptions.damaged,
            allowNa: nextOptions.na,
          }
        : {}),
    },
  });

  res.json({
    ...updated,
    options: formItemOptions(updated),
  });
});

apiInspectionsRouter.delete("/form-items/:id", requireAdmin, async (req, res) => {
  const id = typeof req.params.id === "string" ? req.params.id : "";
  if (!id) {
    res.status(400).json({ error: "Invalid inspection form item id." });
    return;
  }

  const existing = await prisma.inspectionFormItem.findUnique({ where: { id } });
  if (!existing) {
    res.status(404).json({ error: "Inspection form item not found." });
    return;
  }

  await prisma.inspectionFormItem.delete({ where: { id } });
  res.status(204).send();
});

apiInspectionsRouter.get("/inventory/:inventoryId/form", requireTech, async (req, res) => {
  const inventoryId =
    typeof req.params.inventoryId === "string" ? req.params.inventoryId.trim() : "";
  if (!inventoryId) {
    res.status(400).json({ error: "Invalid inventory id." });
    return;
  }

  const inventory = await prisma.inventory.findUnique({
    where: { id: inventoryId },
    include: { asset: true },
  });
  if (!inventory) {
    res.status(404).json({ error: "Inventory unit not found." });
    return;
  }

  const form = await resolveFormForAsset(inventory.assetId);
  if (!form) {
    res.status(404).json({ error: "Inspection form mapping not found for this unit type." });
    return;
  }

  const items = await prisma.inspectionFormItem.findMany({
    where: { formId: form.id, active: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  res.json({
    inventoryId: inventory.id,
    assetId: inventory.assetId,
    assetType: inventory.asset?.type ?? null,
    form: {
      id: form.id,
      name: form.name,
      active: form.active,
      requireHourMeterEntry: form.requireHourMeterEntry,
    },
    items: items.map((row) => ({
      ...row,
      options: formItemOptions(row),
    })),
  });
});

apiInspectionsRouter.post("/inventory/:inventoryId/complete", requireTech, async (req, res) => {
  const inventoryId =
    typeof req.params.inventoryId === "string" ? req.params.inventoryId.trim() : "";
  if (!inventoryId) {
    res.status(400).json({ error: "Invalid inventory id." });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const rawItems = Array.isArray(body.items) ? body.items : [];
  const rawHourMeterReading = Number(body.hourMeterReading);
  const hasHourMeterReading = Number.isFinite(rawHourMeterReading);
  const hourMeterReading = hasHourMeterReading ? Number(rawHourMeterReading) : null;
  const submittedItems = rawItems
    .map((item) => {
      const asRecord = item as Record<string, unknown>;
      const formItemId =
        typeof asRecord.formItemId === "string" ? asRecord.formItemId.trim() : "";
      const options = parseInspectionOptions(asRecord.options, EMPTY_OPTIONS);
      return { formItemId, options };
    })
    .filter((item) => item.formItemId);

  const inventory = await prisma.inventory.findUnique({
    where: { id: inventoryId },
    include: { asset: true },
  });
  if (!inventory) {
    res.status(404).json({ error: "Inventory unit not found." });
    return;
  }

  if (!isReturnedStatus(inventory.status) && !isDownStatus(inventory.status)) {
    res.status(400).json({ error: "Unit must be in Returned or Down status for inspection." });
    return;
  }
  if (hourMeterReading !== null && hourMeterReading < 0) {
    res.status(400).json({
      error: "Hour meter entry cannot be negative.",
    });
    return;
  }

  const form = await resolveFormForAsset(inventory.assetId);
  if (!form) {
    res.status(400).json({ error: "No inspection form is mapped to this unit type." });
    return;
  }

  if (form.requireHourMeterEntry) {
    if (hourMeterReading === null) {
      res.status(400).json({
        error: "Hour meter entry is required for this inspection form.",
      });
      return;
    }
    const unitHours = await getCurrentInventoryHours(inventory.id);
    if (unitHours === null) {
      res.status(400).json({
        error:
          "Unable to validate hour meter entry because this unit does not have a valid Hours value in Inventory.",
      });
      return;
    }
    if (hourMeterReading < unitHours) {
      res.status(400).json({
        error: `Hour meter entry must be greater than or equal to ${unitHours} (the unit's current Hours value).`,
      });
      return;
    }
  }

  const formItems = await prisma.inspectionFormItem.findMany({
    where: { formId: form.id, active: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  if (formItems.length === 0) {
    res.status(400).json({ error: "No inspection checklist items are configured for this form." });
    return;
  }
  const misconfiguredItems = formItems.filter(
    (item) => !hasAnyOption(formItemOptions(item)),
  );
  if (misconfiguredItems.length > 0) {
    res.status(400).json({
      error:
        "One or more checklist items have no response options configured in Admin.",
      misconfiguredItemIds: misconfiguredItems.map((item) => item.id),
    });
    return;
  }

  const submittedById = new Map(
    submittedItems.map((item) => [item.formItemId, item.options]),
  );
  const nonSingleSelectItems = formItems.filter((item) => {
    const selected = submittedById.get(item.id) ?? EMPTY_OPTIONS;
    return selectedOptionCount(selected) !== 1;
  });
  if (nonSingleSelectItems.length > 0) {
    res.status(400).json({
      error:
        "Each checklist item must have exactly one selected option before submitting inspection.",
      invalidSelectionItemIds: nonSingleSelectItems.map((item) => item.id),
    });
    return;
  }
  const invalidItems = formItems.filter((item) => {
    const selected = submittedById.get(item.id) ?? EMPTY_OPTIONS;
    const allowed = formItemOptions(item);
    return hasDisallowedSelection(selected, allowed);
  });
  if (invalidItems.length > 0) {
    res.status(400).json({
      error: "One or more selected options are not allowed for their checklist item.",
      invalidItemIds: invalidItems.map((item) => item.id),
    });
    return;
  }

  const needsAttentionSelected = formItems.some((item) => {
    const selected = submittedById.get(item.id) ?? EMPTY_OPTIONS;
    return selected.needsAttention;
  });
  const damagedSelected = formItems.some((item) => {
    const selected = submittedById.get(item.id) ?? EMPTY_OPTIONS;
    return selected.damaged;
  });
  const followupRaw =
    body.followup && typeof body.followup === "object"
      ? (body.followup as Record<string, unknown>)
      : {};
  const issueDescription =
    typeof followupRaw.issueDescription === "string"
      ? followupRaw.issueDescription.trim()
      : "";
  const damageDescription =
    typeof followupRaw.damageDescription === "string"
      ? followupRaw.damageDescription.trim()
      : "";
  const damagePhotos = Array.isArray(followupRaw.damagePhotos)
    ? followupRaw.damagePhotos
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean)
    : [];
  if (needsAttentionSelected && !issueDescription) {
    res.status(400).json({
      error: "Describe the issue is required when Needs attention is selected.",
    });
    return;
  }
  if (damagedSelected) {
    if (!damageDescription) {
      res.status(400).json({
        error: "Description of Damages is required when Damaged is selected.",
      });
      return;
    }
    if (damagePhotos.length === 0) {
      res.status(400).json({
        error: "At least one damage photo is required when Damaged is selected.",
      });
      return;
    }
  }
  const reasonParts: string[] = [];
  if (damagedSelected && damageDescription) {
    reasonParts.push(`Damaged: ${damageDescription}`);
  }
  if (needsAttentionSelected && issueDescription) {
    reasonParts.push(`Needs attention: ${issueDescription}`);
  }
  const downReason = reasonParts.length > 0 ? reasonParts.join(" | ") : null;
  const nextInventoryStatus =
    needsAttentionSelected || damagedSelected ? STATUS_DOWN : STATUS_AVAILABLE;
  const serviceStateOpts: InventoryServiceStateOptions | undefined =
    nextInventoryStatus === STATUS_AVAILABLE
      ? { skipServiceDueAvailabilityDowngradeForIds: new Set([inventoryId]) }
      : undefined;
  const actorName = getTechSession(req)?.techName || "";

  const submittedAt = new Date();
  const submittedAtIso = submittedAt.toISOString();
  const inspectionResult = await prisma.$transaction(async (tx) => {
    const submission = await tx.inspectionSubmission.create({
      data: {
        inventoryId,
        formId: form.id,
        submittedAt,
        ...(actorName ? { submittedByTechName: actorName } : {}),
        ...(hourMeterReading !== null ? { hourMeterReading } : {}),
        itemResults: {
          create: formItems.map((item) => {
            const selected = submittedById.get(item.id) ?? EMPTY_OPTIONS;
            return {
              formItemId: item.id,
              labelSnapshot: item.label,
              checked: hasAnyOption(selected),
              selectedOk: selected.ok,
              selectedNeedsAttention: selected.needsAttention,
              selectedDamaged: selected.damaged,
              selectedNa: selected.na,
            };
          }),
        },
      },
    });

    const updated = await tx.inventory.update({
      where: { id: inventoryId },
      data: {
        status: nextInventoryStatus,
        ...(hourMeterReading !== null ? { hours: hourMeterReading } : {}),
        downReason: nextInventoryStatus === STATUS_DOWN ? downReason : null,
        inspectionRequired: false,
        lastInspectionCompletedAt: submittedAt,
      },
      include: { asset: true },
    });

    return { unit: updated, inspectionSubmissionId: submission.id };
  });
  await appendRepairHistoryEntry({
    inventoryId,
    action: nextInventoryStatus === STATUS_DOWN ? "DOWN" : "COMPLETE",
    details:
      nextInventoryStatus === STATUS_DOWN
        ? downReason || "Inspection result moved this unit to Down."
        : "Inspection completed and unit returned to Available.",
    techName: actorName || null,
    repairHours:
      nextInventoryStatus === STATUS_AVAILABLE && hourMeterReading !== null
        ? hourMeterReading
        : null,
    createdAt: submittedAt,
  });
  await completeOpenMaintenanceTasksForInspection(
    inventoryId,
    inspectionResult.inspectionSubmissionId,
    form.id,
    submittedAtIso,
    serviceStateOpts,
  );
  await evaluateMaintenanceRulesForUnits([inventoryId], serviceStateOpts);

  invalidateInventoryCache();

  const refreshedUnit = await prisma.inventory.findUnique({
    where: { id: inventoryId },
    include: { asset: true },
  });
  const unit = refreshedUnit || inspectionResult.unit;
  const unitStatus = normalizeStatus(unit.status);

  if (unitStatus === STATUS_AVAILABLE) {
    await removeReturnedOnRentUnit(inventoryId);
  }

  res.json({
    ok: true,
    unit: {
      ...unit,
      status: unitStatus,
    },
  });
});

apiInspectionsRouter.get("/inventory/:inventoryId/required", async (req, res) => {
  const inventoryId =
    typeof req.params.inventoryId === "string" ? req.params.inventoryId.trim() : "";
  if (!inventoryId) {
    res.status(400).json({ error: "Invalid inventory id." });
    return;
  }

  const inventory = await prisma.inventory.findUnique({
    where: { id: inventoryId },
    select: {
      id: true,
      status: true,
      inspectionRequired: true,
      lastInspectionCompletedAt: true,
    },
  });
  if (!inventory) {
    res.status(404).json({ error: "Inventory unit not found." });
    return;
  }

  res.json({
    ...inventory,
    status: normalizeStatus(inventory.status),
    returned: isReturnedStatus(inventory.status),
    available: isAvailableStatus(inventory.status),
  });
});
