-- Add admin-configurable default location point for History workflows.
ALTER TABLE "AppSettings"
  ADD COLUMN IF NOT EXISTS "historyLocationName" TEXT,
  ADD COLUMN IF NOT EXISTS "historyLocationLatitude" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "historyLocationLongitude" DOUBLE PRECISION;
