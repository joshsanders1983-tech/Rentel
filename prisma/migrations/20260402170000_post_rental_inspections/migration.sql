-- Queue post-rental inspection findings for Shop review + spreadsheet offload.
CREATE TABLE IF NOT EXISTS "PostRentalInspection" (
  "id" TEXT NOT NULL,
  "inspectionSubmissionId" TEXT NOT NULL,
  "inventoryId" TEXT NOT NULL,
  "unitNumberSnapshot" TEXT NOT NULL,
  "assetTypeSnapshot" TEXT,
  "assetDescriptionSnapshot" TEXT,
  "techNameSnapshot" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL,
  "issueDescription" TEXT,
  "damageDescription" TEXT,
  "damagePhotosJson" JSONB NOT NULL,
  "flaggedItemsJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PostRentalInspection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PostRentalInspection_inspectionSubmissionId_key"
  ON "PostRentalInspection"("inspectionSubmissionId");

CREATE INDEX IF NOT EXISTS "PostRentalInspection_submittedAt_idx"
  ON "PostRentalInspection"("submittedAt");

CREATE INDEX IF NOT EXISTS "PostRentalInspection_createdAt_idx"
  ON "PostRentalInspection"("createdAt");
