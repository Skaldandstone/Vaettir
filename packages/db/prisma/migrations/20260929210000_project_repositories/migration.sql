CREATE TABLE "ProjectRepository" (
 "id" TEXT NOT NULL, "projectId" TEXT NOT NULL, "provider" TEXT NOT NULL,
 "url" TEXT NOT NULL, "revision" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ProjectRepository_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "ProjectRepository_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProjectRepository_projectId_provider_url_key" ON "ProjectRepository"("projectId", "provider", "url");
