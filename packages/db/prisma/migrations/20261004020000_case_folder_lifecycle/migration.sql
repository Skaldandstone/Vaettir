-- Additive only: existing suites, case numbers, order and history are unchanged.
CREATE TABLE "CaseFolderState" (
  "projectId" TEXT NOT NULL PRIMARY KEY REFERENCES "Project"(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  folders JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(folders)='array' AND jsonb_array_length(folders)<=500 AND octet_length(folders::text)<=262144),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "CaseFolderWrite" (
  id TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL REFERENCES "Project"(id) ON DELETE RESTRICT,
  "actorId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "inputHash" TEXT NOT NULL,
  receipt JSONB NOT NULL CHECK (octet_length(receipt::text)<=2097152),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "CaseFolderWrite_projectId_actorId_requestId_key" ON "CaseFolderWrite"("projectId","actorId","requestId");
CREATE INDEX "CaseFolderWrite_projectId_createdAt_idx" ON "CaseFolderWrite"("projectId","createdAt");
CREATE FUNCTION vaettir_case_folder_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' AND current_setting('vaettir.case_folder_erasure',true)=
    (SELECT "organizationId" FROM "Project" WHERE id=OLD."projectId") THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Case folder receipts are append-only; only explicitly scoped organization erasure may delete them';
END $$;
CREATE TRIGGER "CaseFolderWrite_immutable" BEFORE UPDATE OR DELETE ON "CaseFolderWrite"
  FOR EACH ROW EXECUTE FUNCTION vaettir_case_folder_receipt_guard();
