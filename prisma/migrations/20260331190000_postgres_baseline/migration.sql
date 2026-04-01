-- CreateEnum
CREATE TYPE "ReservationListKind" AS ENUM ('RESERVATION', 'ON_RENT', 'RETURNED', 'POTENTIAL');

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "inspectionFormId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inventory" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "unitNumber" TEXT NOT NULL,
    "hours" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "downReason" TEXT,
    "inspectionRequired" BOOLEAN NOT NULL DEFAULT false,
    "lastInspectionCompletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepairHistoryEntry" (
    "id" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "techName" TEXT,
    "repairHours" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepairHistoryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryStatusOption" (
    "id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryStatusOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionFormItem" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "allowOk" BOOLEAN NOT NULL DEFAULT true,
    "allowNeedsAttention" BOOLEAN NOT NULL DEFAULT true,
    "allowDamaged" BOOLEAN NOT NULL DEFAULT true,
    "allowNa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InspectionFormItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionSubmission" (
    "id" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "formId" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hourMeterReading" DOUBLE PRECISION,

    CONSTRAINT "InspectionSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionForm" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "requireHourMeterEntry" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InspectionForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionSubmissionItem" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "formItemId" TEXT,
    "labelSnapshot" TEXT NOT NULL,
    "checked" BOOLEAN NOT NULL,
    "selectedOk" BOOLEAN NOT NULL DEFAULT false,
    "selectedNeedsAttention" BOOLEAN NOT NULL DEFAULT false,
    "selectedDamaged" BOOLEAN NOT NULL DEFAULT false,
    "selectedNa" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "InspectionSubmissionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InspectionConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "requireHourMeterEntry" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InspectionConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnRentHourSnapshot" (
    "id" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "hoursAtOnRent" DOUBLE PRECISION,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnRentHourSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Technician" (
    "id" TEXT NOT NULL,
    "techName" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Technician_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationMeta" (
    "id" TEXT NOT NULL,
    "orderCounter" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ReservationMeta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LastRentedByUnit" (
    "unitId" TEXT NOT NULL,
    "activatedAtIso" TEXT NOT NULL,

    CONSTRAINT "LastRentedByUnit_pkey" PRIMARY KEY ("unitId")
);

-- CreateTable
CREATE TABLE "ReservationEntry" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "assignedUnits" JSONB NOT NULL,
    "groupKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "listKind" "ReservationListKind" NOT NULL,
    "listEnteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),

    CONSTRAINT "ReservationEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Asset_asset_key" ON "Asset"("asset");

-- CreateIndex
CREATE INDEX "Asset_inspectionFormId_idx" ON "Asset"("inspectionFormId");

-- CreateIndex
CREATE INDEX "Inventory_assetId_idx" ON "Inventory"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "Inventory_unitNumber_key" ON "Inventory"("unitNumber");

-- CreateIndex
CREATE INDEX "RepairHistoryEntry_inventoryId_createdAt_idx" ON "RepairHistoryEntry"("inventoryId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryStatusOption_value_key" ON "InventoryStatusOption"("value");

-- CreateIndex
CREATE INDEX "InspectionFormItem_formId_active_sortOrder_idx" ON "InspectionFormItem"("formId", "active", "sortOrder");

-- CreateIndex
CREATE INDEX "InspectionSubmission_inventoryId_submittedAt_idx" ON "InspectionSubmission"("inventoryId", "submittedAt");

-- CreateIndex
CREATE INDEX "InspectionSubmissionItem_submissionId_idx" ON "InspectionSubmissionItem"("submissionId");

-- CreateIndex
CREATE INDEX "InspectionSubmissionItem_formItemId_idx" ON "InspectionSubmissionItem"("formItemId");

-- CreateIndex
CREATE INDEX "OnRentHourSnapshot_inventoryId_capturedAt_idx" ON "OnRentHourSnapshot"("inventoryId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Technician_username_key" ON "Technician"("username");

-- CreateIndex
CREATE INDEX "Technician_active_techName_idx" ON "Technician"("active", "techName");

-- CreateIndex
CREATE INDEX "ReservationEntry_listKind_listEnteredAt_idx" ON "ReservationEntry"("listKind", "listEnteredAt");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_inspectionFormId_fkey" FOREIGN KEY ("inspectionFormId") REFERENCES "InspectionForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairHistoryEntry" ADD CONSTRAINT "RepairHistoryEntry_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "Inventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionFormItem" ADD CONSTRAINT "InspectionFormItem_formId_fkey" FOREIGN KEY ("formId") REFERENCES "InspectionForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionSubmission" ADD CONSTRAINT "InspectionSubmission_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "Inventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionSubmission" ADD CONSTRAINT "InspectionSubmission_formId_fkey" FOREIGN KEY ("formId") REFERENCES "InspectionForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionSubmissionItem" ADD CONSTRAINT "InspectionSubmissionItem_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "InspectionSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InspectionSubmissionItem" ADD CONSTRAINT "InspectionSubmissionItem_formItemId_fkey" FOREIGN KEY ("formItemId") REFERENCES "InspectionFormItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnRentHourSnapshot" ADD CONSTRAINT "OnRentHourSnapshot_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "Inventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Singleton for reservation order numbers (used by app upserts)
INSERT INTO "ReservationMeta" ("id", "orderCounter") VALUES ('default', 0);
