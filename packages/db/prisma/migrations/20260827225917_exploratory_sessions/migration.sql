-- CreateEnum
CREATE TYPE "ExploratorySessionStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateTable
CREATE TABLE "ExploratorySession" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "charter" TEXT NOT NULL,
    "status" "ExploratorySessionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "testerId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ExploratorySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExploratorySessionNote" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "isFinding" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExploratorySessionNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExploratorySession_projectId_status_idx" ON "ExploratorySession"("projectId", "status");

-- CreateIndex
CREATE INDEX "ExploratorySessionNote_sessionId_idx" ON "ExploratorySessionNote"("sessionId");

-- AddForeignKey
ALTER TABLE "ExploratorySession" ADD CONSTRAINT "ExploratorySession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExploratorySession" ADD CONSTRAINT "ExploratorySession_testerId_fkey" FOREIGN KEY ("testerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExploratorySessionNote" ADD CONSTRAINT "ExploratorySessionNote_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ExploratorySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
