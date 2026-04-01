-- CreateTable
CREATE TABLE "ServiceHistoryEntry" (
    "id" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "details" TEXT,
    "techName" TEXT,
    "repairHours" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceHistoryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ServiceHistoryEntry_inventoryId_createdAt_idx" ON "ServiceHistoryEntry"("inventoryId", "createdAt");

-- AddForeignKey
ALTER TABLE "ServiceHistoryEntry" ADD CONSTRAINT "ServiceHistoryEntry_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "Inventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
