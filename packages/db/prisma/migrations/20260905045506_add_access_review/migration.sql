-- CreateEnum
CREATE TYPE "AccessReviewDecision" AS ENUM ('CONFIRMED', 'REVOKED');

-- CreateTable
CREATE TABLE "AccessReview" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "performedById" TEXT NOT NULL,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessReviewEntry" (
    "id" TEXT NOT NULL,
    "accessReviewId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL,
    "seatType" "SeatType" NOT NULL,
    "decision" "AccessReviewDecision" NOT NULL,
    "note" TEXT,

    CONSTRAINT "AccessReviewEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccessReview_organizationId_performedAt_idx" ON "AccessReview"("organizationId", "performedAt");

-- CreateIndex
CREATE INDEX "AccessReviewEntry_accessReviewId_idx" ON "AccessReviewEntry"("accessReviewId");

-- AddForeignKey
ALTER TABLE "AccessReview" ADD CONSTRAINT "AccessReview_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessReview" ADD CONSTRAINT "AccessReview_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessReviewEntry" ADD CONSTRAINT "AccessReviewEntry_accessReviewId_fkey" FOREIGN KEY ("accessReviewId") REFERENCES "AccessReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
