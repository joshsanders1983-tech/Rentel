-- CreateTable
CREATE TABLE "InspectionFormItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "InspectionSubmission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "inventoryId" TEXT NOT NULL,
    "submittedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InspectionSubmission_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "Inventory" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InspectionSubmissionItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "submissionId" TEXT NOT NULL,
    "formItemId" TEXT,
    "labelSnapshot" TEXT NOT NULL,
    "checked" BOOLEAN NOT NULL,
    CONSTRAINT "InspectionSubmissionItem_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "InspectionSubmission" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InspectionSubmissionItem_formItemId_fkey" FOREIGN KEY ("formItemId") REFERENCES "InspectionFormItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Inventory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetId" TEXT NOT NULL,
    "unitNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "inspectionRequired" BOOLEAN NOT NULL DEFAULT false,
    "lastInspectionCompletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Inventory_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Inventory" ("assetId", "createdAt", "id", "status", "unitNumber") SELECT "assetId", "createdAt", "id", "status", "unitNumber" FROM "Inventory";
DROP TABLE "Inventory";
ALTER TABLE "new_Inventory" RENAME TO "Inventory";
CREATE INDEX "Inventory_assetId_idx" ON "Inventory"("assetId");
CREATE UNIQUE INDEX "Inventory_unitNumber_key" ON "Inventory"("unitNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Backfill returned units so they are inspection-locked after migration.
UPDATE "Inventory"
SET "inspectionRequired" = true
WHERE UPPER(TRIM("status")) LIKE 'RETURN%';

-- CreateIndex
CREATE INDEX "InspectionFormItem_active_sortOrder_idx" ON "InspectionFormItem"("active", "sortOrder");

-- CreateIndex
CREATE INDEX "InspectionSubmission_inventoryId_submittedAt_idx" ON "InspectionSubmission"("inventoryId", "submittedAt");

-- CreateIndex
CREATE INDEX "InspectionSubmissionItem_submissionId_idx" ON "InspectionSubmissionItem"("submissionId");

-- CreateIndex
CREATE INDEX "InspectionSubmissionItem_formItemId_idx" ON "InspectionSubmissionItem"("formItemId");
