-- Persist tech name on completed inspections for Unit History.
ALTER TABLE "InspectionSubmission" ADD COLUMN IF NOT EXISTS "submittedByTechName" TEXT;
