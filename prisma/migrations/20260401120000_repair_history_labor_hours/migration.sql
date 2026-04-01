-- Shop complete repair: labor hours stored separately from unit meter hours (repairHours).
ALTER TABLE "RepairHistoryEntry" ADD COLUMN IF NOT EXISTS "laborHours" DOUBLE PRECISION;
