CREATE TABLE "CaseAnalysisQueue" (
 "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "projectId" TEXT NOT NULL,
 "requestedById" TEXT NOT NULL, "action" TEXT NOT NULL, "requestId" TEXT NOT NULL,
 "selectionHash" TEXT NOT NULL, "scopeHash" TEXT NOT NULL, "maximumCredits" INTEGER NOT NULL,
 "caseCount" INTEGER NOT NULL, "status" TEXT NOT NULL DEFAULT 'REVIEW', "approvedAt" TIMESTAMP(3),
 "cancelledAt" TIMESTAMP(3), "leaseOwner" TEXT, "leaseExpiresAt" TIMESTAMP(3), "activeItemId" TEXT,
 "reason" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "CaseAnalysisQueue_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "CaseAnalysisQueue_bounded_scope" CHECK ("caseCount" BETWEEN 1 AND 1000 AND "maximumCredits" BETWEEN 0 AND 12000),
 CONSTRAINT "CaseAnalysisQueue_action" CHECK ("action" IN ('RISK','TYPE_DESIGN')),
 CONSTRAINT "CaseAnalysisQueue_status" CHECK ("status" IN ('REVIEW','QUEUED','RUNNING','STOPPED','COMPLETE','CANCELLED'))
);
CREATE TABLE "CaseAnalysisQueueItem" (
 "id" TEXT NOT NULL, "queueId" TEXT NOT NULL, "caseId" TEXT NOT NULL, "displayId" TEXT NOT NULL,
 "position" INTEGER NOT NULL, "inputHash" TEXT NOT NULL, "contentRevision" TEXT NOT NULL,
 "sourceRevision" TEXT NOT NULL, "caseUpdatedAt" TIMESTAMP(3) NOT NULL, "maximumCredits" INTEGER NOT NULL,
 "status" TEXT NOT NULL, "reason" TEXT, "chargeId" TEXT, "actualCredits" INTEGER, "refund" INTEGER,
 "excessNotCharged" INTEGER, "meteredAt" TIMESTAMP(3), "startedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3),
 CONSTRAINT "CaseAnalysisQueueItem_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "CaseAnalysisQueueItem_bounded" CHECK ("position" BETWEEN 0 AND 999 AND "maximumCredits" BETWEEN 0 AND 12),
 CONSTRAINT "CaseAnalysisQueueItem_status" CHECK ("status" IN ('QUEUED','RUNNING','SAVED','SKIPPED','READY','FAILED','UNKNOWN'))
);
CREATE UNIQUE INDEX "CaseAnalysisQueue_projectId_requestedById_requestId_key" ON "CaseAnalysisQueue"("projectId","requestedById","requestId");
CREATE INDEX "CaseAnalysisQueue_status_createdAt_idx" ON "CaseAnalysisQueue"("status","createdAt");
CREATE INDEX "CaseAnalysisQueue_organizationId_projectId_requestedById_createdAt_idx" ON "CaseAnalysisQueue"("organizationId","projectId","requestedById","createdAt");
CREATE UNIQUE INDEX "CaseAnalysisQueueItem_chargeId_key" ON "CaseAnalysisQueueItem"("chargeId");
CREATE UNIQUE INDEX "CaseAnalysisQueueItem_queueId_caseId_key" ON "CaseAnalysisQueueItem"("queueId","caseId");
CREATE UNIQUE INDEX "CaseAnalysisQueueItem_queueId_position_key" ON "CaseAnalysisQueueItem"("queueId","position");
CREATE INDEX "CaseAnalysisQueueItem_queueId_status_position_idx" ON "CaseAnalysisQueueItem"("queueId","status","position");
ALTER TABLE "CaseAnalysisQueue" ADD CONSTRAINT "CaseAnalysisQueue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CaseAnalysisQueue" ADD CONSTRAINT "CaseAnalysisQueue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CaseAnalysisQueueItem" ADD CONSTRAINT "CaseAnalysisQueueItem_queueId_fkey" FOREIGN KEY ("queueId") REFERENCES "CaseAnalysisQueue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
