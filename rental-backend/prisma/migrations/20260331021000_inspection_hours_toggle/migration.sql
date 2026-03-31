ALTER TABLE "InspectionSubmission" ADD COLUMN "hourMeterReading" REAL;

CREATE TABLE "InspectionConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requireHourMeterEntry" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

INSERT INTO "InspectionConfig" ("id", "requireHourMeterEntry", "createdAt", "updatedAt")
VALUES ("default", false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

CREATE TABLE "OnRentHourSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "inventoryId" TEXT NOT NULL,
    "hoursAtOnRent" REAL,
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OnRentHourSnapshot_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "Inventory" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "OnRentHourSnapshot_inventoryId_capturedAt_idx" ON "OnRentHourSnapshot"("inventoryId", "capturedAt");
