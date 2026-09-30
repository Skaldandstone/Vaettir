ALTER TABLE "TestCaseStep"
  ADD COLUMN "mediaAttachmentIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
