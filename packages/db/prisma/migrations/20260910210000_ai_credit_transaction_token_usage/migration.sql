-- P12-12: record real token usage per AI consumption row (nullable, additive).
ALTER TABLE "AiCreditTransaction"
  ADD COLUMN "inputTokens" INTEGER,
  ADD COLUMN "outputTokens" INTEGER,
  ADD COLUMN "aiCalls" INTEGER,
  ADD COLUMN "model" TEXT;
