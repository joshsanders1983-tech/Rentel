-- Add app-level offload destinations and Google Sheets credentials.
ALTER TABLE "AppSettings"
  ADD COLUMN IF NOT EXISTS "offloadOrderHistoryLocation" TEXT,
  ADD COLUMN IF NOT EXISTS "offloadServiceHistoryLocation" TEXT,
  ADD COLUMN IF NOT EXISTS "offloadDamageHistoryLocation" TEXT,
  ADD COLUMN IF NOT EXISTS "offloadPostRentalInspectionsLocation" TEXT,
  ADD COLUMN IF NOT EXISTS "googleSheetsClientEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "googleSheetsPrivateKey" TEXT,
  ADD COLUMN IF NOT EXISTS "googleSheetsSheetId" TEXT,
  ADD COLUMN IF NOT EXISTS "googleSheetsSheetGid" INTEGER;
