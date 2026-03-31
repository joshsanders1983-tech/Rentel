-- CreateTable
CREATE TABLE "InspectionForm" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "requireHourMeterEntry" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

INSERT INTO "InspectionForm" ("id", "name", "active", "requireHourMeterEntry", "createdAt", "updatedAt")
SELECT
    'default_form',
    'Default Inspection Form',
    true,
    COALESCE(
      (SELECT "requireHourMeterEntry" FROM "InspectionConfig" WHERE "id" = 'default'),
      false
    ),
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Asset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "asset" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "inspectionFormId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Asset_inspectionFormId_fkey" FOREIGN KEY ("inspectionFormId") REFERENCES "InspectionForm" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Asset" ("id", "asset", "type", "description", "active", "inspectionFormId", "createdAt")
SELECT "id", "asset", "type", "description", "active", 'default_form', "createdAt"
FROM "Asset";
DROP TABLE "Asset";
ALTER TABLE "new_Asset" RENAME TO "Asset";
CREATE UNIQUE INDEX "Asset_asset_key" ON "Asset"("asset");
CREATE INDEX "Asset_inspectionFormId_idx" ON "Asset"("inspectionFormId");

CREATE TABLE "new_InspectionFormItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "formId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "allowOk" BOOLEAN NOT NULL DEFAULT true,
    "allowNeedsAttention" BOOLEAN NOT NULL DEFAULT true,
    "allowDamaged" BOOLEAN NOT NULL DEFAULT true,
    "allowNa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InspectionFormItem_formId_fkey" FOREIGN KEY ("formId") REFERENCES "InspectionForm" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_InspectionFormItem" (
    "id",
    "formId",
    "label",
    "sortOrder",
    "active",
    "allowOk",
    "allowNeedsAttention",
    "allowDamaged",
    "allowNa",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    'default_form',
    "label",
    "sortOrder",
    "active",
    "allowOk",
    "allowNeedsAttention",
    "allowDamaged",
    "allowNa",
    "createdAt",
    "updatedAt"
FROM "InspectionFormItem";
DROP TABLE "InspectionFormItem";
ALTER TABLE "new_InspectionFormItem" RENAME TO "InspectionFormItem";
CREATE INDEX "InspectionFormItem_formId_active_sortOrder_idx" ON "InspectionFormItem"("formId", "active", "sortOrder");

CREATE TABLE "new_InspectionSubmission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "inventoryId" TEXT NOT NULL,
    "formId" TEXT,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hourMeterReading" REAL,
    CONSTRAINT "InspectionSubmission_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "Inventory" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InspectionSubmission_formId_fkey" FOREIGN KEY ("formId") REFERENCES "InspectionForm" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_InspectionSubmission" ("id", "inventoryId", "formId", "submittedAt", "hourMeterReading")
SELECT "id", "inventoryId", 'default_form', "submittedAt", "hourMeterReading"
FROM "InspectionSubmission";
DROP TABLE "InspectionSubmission";
ALTER TABLE "new_InspectionSubmission" RENAME TO "InspectionSubmission";
CREATE INDEX "InspectionSubmission_inventoryId_submittedAt_idx" ON "InspectionSubmission"("inventoryId", "submittedAt");
CREATE INDEX "InspectionSubmission_formId_idx" ON "InspectionSubmission"("formId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
