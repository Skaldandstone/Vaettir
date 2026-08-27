-- CreateTable
CREATE TABLE "CustomFrameworkHeuristic" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "exampleFilePaths" TEXT[],
    "confidence" DOUBLE PRECISION,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomFrameworkHeuristic_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomFrameworkHeuristic_projectId_idx" ON "CustomFrameworkHeuristic"("projectId");

-- AddForeignKey
ALTER TABLE "CustomFrameworkHeuristic" ADD CONSTRAINT "CustomFrameworkHeuristic_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFrameworkHeuristic" ADD CONSTRAINT "CustomFrameworkHeuristic_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
