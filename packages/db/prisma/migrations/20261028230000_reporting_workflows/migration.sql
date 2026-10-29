-- CreateTable
CREATE TABLE "ProjectReportDashboard" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastRequestId" TEXT NOT NULL,
    "lastRequestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectReportDashboard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectReportSchedule" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRequestId" TEXT NOT NULL,
    "lastRequestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectReportSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectReportScheduleRun" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "scheduleVersion" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "snapshotId" TEXT,
    "failureCode" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectReportScheduleRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectReportDashboard_projectId_organizationId_ownerId_idx" ON "ProjectReportDashboard"("projectId", "organizationId", "ownerId");

-- CreateIndex
CREATE INDEX "ProjectReportSchedule_enabled_nextRunAt_idx" ON "ProjectReportSchedule"("enabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "ProjectReportSchedule_projectId_organizationId_ownerId_idx" ON "ProjectReportSchedule"("projectId", "organizationId", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectReportScheduleRun_scheduleId_scheduledFor_key" ON "ProjectReportScheduleRun"("scheduleId", "scheduledFor");

-- AddForeignKey
ALTER TABLE "ProjectReportDashboard" ADD CONSTRAINT "ProjectReportDashboard_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectReportSchedule" ADD CONSTRAINT "ProjectReportSchedule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectReportScheduleRun" ADD CONSTRAINT "ProjectReportScheduleRun_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "ProjectReportSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
