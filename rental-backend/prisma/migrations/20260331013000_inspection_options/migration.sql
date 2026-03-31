ALTER TABLE "InspectionFormItem" ADD COLUMN "allowOk" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "InspectionFormItem" ADD COLUMN "allowNeedsAttention" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "InspectionFormItem" ADD COLUMN "allowDamaged" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "InspectionFormItem" ADD COLUMN "allowNa" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "InspectionSubmissionItem" ADD COLUMN "selectedOk" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "InspectionSubmissionItem" ADD COLUMN "selectedNeedsAttention" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "InspectionSubmissionItem" ADD COLUMN "selectedDamaged" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "InspectionSubmissionItem" ADD COLUMN "selectedNa" BOOLEAN NOT NULL DEFAULT false;

-- Backfill existing submissions from legacy checkbox-only inspections.
UPDATE "InspectionSubmissionItem"
SET "selectedNa" = true
WHERE "checked" = true
  AND "selectedOk" = false
  AND "selectedNeedsAttention" = false
  AND "selectedDamaged" = false
  AND "selectedNa" = false;
