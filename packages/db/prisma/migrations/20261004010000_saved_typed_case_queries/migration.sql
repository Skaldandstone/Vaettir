CREATE TABLE "SavedTypedCaseQuery" (
  id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "projectId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL, name TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'PRIVATE',
  definition JSONB NOT NULL, columns JSONB NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  "deletedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SavedTypedCaseQuery_visibility_check" CHECK (visibility IN ('PRIVATE','SHARED')),
  CONSTRAINT "SavedTypedCaseQuery_version_check" CHECK (version BETWEEN 1 AND 1000000),
  CONSTRAINT "SavedTypedCaseQuery_name_check" CHECK (length(name) BETWEEN 1 AND 80),
  CONSTRAINT "SavedTypedCaseQuery_size_check" CHECK (octet_length(definition::text)<=12000 AND octet_length(columns::text)<=200),
  CONSTRAINT "SavedTypedCaseQuery_org_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SavedTypedCaseQuery_project_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "SavedTypedCaseQuery_scope_idx" ON "SavedTypedCaseQuery" ("projectId","organizationId",visibility,"deletedAt","updatedAt");
CREATE INDEX "SavedTypedCaseQuery_owner_idx" ON "SavedTypedCaseQuery" ("projectId","createdById","deletedAt");
CREATE TABLE "SavedTypedCaseQueryWrite" (
  id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL, "projectId" TEXT NOT NULL,
  "queryId" TEXT NOT NULL, "actorId" TEXT NOT NULL, "requestId" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL, response JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SavedTypedCaseQueryWrite_hash_check" CHECK (length("requestHash")=64),
  CONSTRAINT "SavedTypedCaseQueryWrite_response_check" CHECK (octet_length(response::text)<=16000),
  CONSTRAINT "SavedTypedCaseQueryWrite_org_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SavedTypedCaseQueryWrite_project_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SavedTypedCaseQueryWrite_query_fkey" FOREIGN KEY ("queryId") REFERENCES "SavedTypedCaseQuery"(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SavedTypedCaseQueryWrite_request_key" ON "SavedTypedCaseQueryWrite" ("projectId","actorId","requestId");
CREATE INDEX "SavedTypedCaseQueryWrite_scope_idx" ON "SavedTypedCaseQueryWrite" ("organizationId","projectId");
