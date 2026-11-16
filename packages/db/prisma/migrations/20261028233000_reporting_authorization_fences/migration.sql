ALTER TABLE "ProjectReportSchedule" ADD COLUMN "pauseReason" TEXT;

-- A revoked recurring mandate must not revive if access returns before a tick.
-- These triggers only pause report schedules; they never modify memberships,
-- sessions, project ownership or other jobs. Explicit save renews the mandate.
CREATE FUNCTION pause_reporting_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE "ProjectReportSchedule" SET enabled=false,"pauseReason"='ACCESS_CHANGED',version=version+1,"updatedAt"=CURRENT_TIMESTAMP
      WHERE "membershipId"=OLD.id AND enabled;
    RETURN OLD;
  END IF;
  IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId" OR NEW."userId" IS DISTINCT FROM OLD."userId"
     OR NEW."seatType"::text <> 'FULL' OR NEW.role::text NOT IN ('OWNER','ADMIN','EDITOR') THEN
    UPDATE "ProjectReportSchedule" SET enabled=false,"pauseReason"='ACCESS_CHANGED',version=version+1,"updatedAt"=CURRENT_TIMESTAMP
      WHERE "membershipId"=OLD.id AND enabled;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reporting_membership_revocation AFTER UPDATE OR DELETE ON "Membership"
  FOR EACH ROW EXECUTE FUNCTION pause_reporting_membership();

CREATE FUNCTION pause_reporting_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'Organization' THEN
    IF NEW."suspendedAt" IS NOT NULL AND NEW."suspendedAt" IS DISTINCT FROM OLD."suspendedAt" THEN
      UPDATE "ProjectReportSchedule" SET enabled=false,"pauseReason"='ACCESS_CHANGED',version=version+1,"updatedAt"=CURRENT_TIMESTAMP
        WHERE "organizationId"=OLD.id AND enabled;
    END IF;
  ELSIF TG_TABLE_NAME = 'Project' THEN
    IF NEW."organizationId" IS DISTINCT FROM OLD."organizationId" THEN
      UPDATE "ProjectReportSchedule" SET enabled=false,"pauseReason"='ACCESS_CHANGED',version=version+1,"updatedAt"=CURRENT_TIMESTAMP
        WHERE "projectId"=OLD.id AND enabled;
    END IF;
  ELSIF TG_TABLE_NAME = 'User' THEN
    IF NEW."clerkUserId" IS DISTINCT FROM OLD."clerkUserId" THEN
      UPDATE "ProjectReportSchedule" SET enabled=false,"pauseReason"='ACCESS_CHANGED',version=version+1,"updatedAt"=CURRENT_TIMESTAMP
        WHERE "ownerId"=OLD.id AND enabled;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reporting_org_suspension AFTER UPDATE OF "suspendedAt" ON "Organization"
  FOR EACH ROW EXECUTE FUNCTION pause_reporting_scope();
CREATE TRIGGER reporting_project_transfer AFTER UPDATE OF "organizationId" ON "Project"
  FOR EACH ROW EXECUTE FUNCTION pause_reporting_scope();
CREATE TRIGGER reporting_subject_change AFTER UPDATE OF "clerkUserId" ON "User"
  FOR EACH ROW EXECUTE FUNCTION pause_reporting_scope();

ALTER TABLE "ProjectReportDashboard" ADD CONSTRAINT "report_dashboard_visibility_check" CHECK (visibility IN ('private','project'));
ALTER TABLE "ProjectReportDashboard" ADD CONSTRAINT "report_dashboard_version_check" CHECK (version > 0);
ALTER TABLE "ProjectReportSchedule" ADD CONSTRAINT "report_schedule_version_check" CHECK (version > 0);
ALTER TABLE "ProjectReportScheduleRun" ADD CONSTRAINT "report_run_status_check" CHECK (status IN ('CAPTURED','FAILED'));
ALTER TABLE "ProjectReportScheduleRun" ADD CONSTRAINT "report_run_receipt_check" CHECK ((status='CAPTURED' AND "snapshotId" IS NOT NULL AND "failureCode" IS NULL) OR (status='FAILED' AND "snapshotId" IS NULL AND "failureCode" IS NOT NULL));
