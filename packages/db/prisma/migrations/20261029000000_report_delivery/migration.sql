ALTER TABLE "ProjectReportSchedule" ADD COLUMN "deliveryDestinationHash" TEXT;
ALTER TABLE "ProjectReportScheduleRun" ADD COLUMN "deliveryStatus" TEXT NOT NULL DEFAULT 'NOT_REQUESTED',
  ADD COLUMN "deliveryAttemptAt" TIMESTAMP(3), ADD COLUMN "deliveredAt" TIMESTAMP(3);
ALTER TABLE "ProjectReportScheduleRun" ADD CONSTRAINT "report_delivery_status_check"
  CHECK ("deliveryStatus" IN ('NOT_REQUESTED','PENDING','SENDING','SENT','UNKNOWN','CANCELLED'));

-- Retain all existing capture fences and add the stronger admin delivery fence.
CREATE OR REPLACE FUNCTION pause_reporting_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE "ProjectReportSchedule" SET enabled=false,"pauseReason"='ACCESS_CHANGED',version=version+1,"updatedAt"=CURRENT_TIMESTAMP
      WHERE "membershipId"=OLD.id AND enabled;
    RETURN OLD;
  END IF;
  UPDATE "ProjectReportSchedule" SET enabled=false,"pauseReason"='ACCESS_CHANGED',version=version+1,"updatedAt"=CURRENT_TIMESTAMP
    WHERE "membershipId"=OLD.id AND enabled AND (
      NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR NEW."userId" IS DISTINCT FROM OLD."userId"
      OR NEW."seatType"::text <> 'FULL' OR NEW.role::text NOT IN ('OWNER','ADMIN','EDITOR')
      OR ("deliveryDestinationHash" IS NOT NULL AND NEW.role::text NOT IN ('OWNER','ADMIN'))
    );
  RETURN NEW;
END $$;

CREATE FUNCTION pause_reporting_destination() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."slackWebhookUrl" IS DISTINCT FROM OLD."slackWebhookUrl" THEN
    UPDATE "ProjectReportSchedule" SET enabled=false,"pauseReason"='DESTINATION_CHANGED',version=version+1,"updatedAt"=CURRENT_TIMESTAMP
      WHERE "organizationId"=OLD.id AND enabled AND "deliveryDestinationHash" IS NOT NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reporting_destination_change AFTER UPDATE OF "slackWebhookUrl" ON "Organization"
  FOR EACH ROW EXECUTE FUNCTION pause_reporting_destination();
CREATE INDEX "ProjectReportScheduleRun_deliveryStatus_createdAt_idx" ON "ProjectReportScheduleRun"("deliveryStatus","createdAt");
