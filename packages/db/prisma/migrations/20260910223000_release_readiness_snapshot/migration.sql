-- P8-04: persisted release readiness snapshots (change detection + history).
CREATE TABLE "ReleaseReadinessSnapshot" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "previousLabel" TEXT,
    "criteriaMet" INTEGER NOT NULL,
    "criteriaTotal" INTEGER NOT NULL,
    "openRiskFlags" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleaseReadinessSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReleaseReadinessSnapshot_releaseId_computedAt_idx" ON "ReleaseReadinessSnapshot"("releaseId", "computedAt");

ALTER TABLE "ReleaseReadinessSnapshot" ADD CONSTRAINT "ReleaseReadinessSnapshot_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;
