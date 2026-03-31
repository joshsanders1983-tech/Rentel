CREATE TABLE "RepairHistoryEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "inventoryId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "techName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RepairHistoryEntry_inventoryId_fkey"
      FOREIGN KEY ("inventoryId")
      REFERENCES "Inventory" ("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE
);

CREATE INDEX "RepairHistoryEntry_inventoryId_createdAt_idx"
ON "RepairHistoryEntry"("inventoryId", "createdAt");
