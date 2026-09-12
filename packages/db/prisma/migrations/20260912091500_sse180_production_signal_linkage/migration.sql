-- CreateEnum
CREATE TYPE "ProductionSignalProvider" AS ENUM ('APPLE_APP_STORE', 'GOOGLE_PLAY');

-- CreateEnum
CREATE TYPE "ProductionSignalConnectionStatus" AS ENUM ('PENDING', 'CONNECTED', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "ProductionSignalType" AS ENUM ('CRASH_REPORT', 'STORE_REVIEW');

-- CreateTable
CREATE TABLE "ProductionSignalConnection" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "provider" "ProductionSignalProvider" NOT NULL,
    "status" "ProductionSignalConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "oauthState" TEXT,
    "encryptedCredentials" TEXT,
    "credentialsIv" TEXT,
    "credentialsAuthTag" TEXT,
    "appleIssuerId" TEXT,
    "appleKeyId" TEXT,
    "scope" TEXT,
    "externalAccountId" TEXT,
    "connectedByUserId" TEXT,
    "connectedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionSignalConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionSignal" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" "ProductionSignalType" NOT NULL,
    "externalId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductionSignalConnection_oauthState_key" ON "ProductionSignalConnection"("oauthState");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionSignalConnection_projectId_provider_key" ON "ProductionSignalConnection"("projectId", "provider");

-- CreateIndex
CREATE INDEX "ProductionSignal_projectId_occurredAt_idx" ON "ProductionSignal"("projectId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionSignal_connectionId_externalId_key" ON "ProductionSignal"("connectionId", "externalId");

-- AddForeignKey
ALTER TABLE "ProductionSignalConnection" ADD CONSTRAINT "ProductionSignalConnection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionSignalConnection" ADD CONSTRAINT "ProductionSignalConnection_connectedByUserId_fkey" FOREIGN KEY ("connectedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionSignal" ADD CONSTRAINT "ProductionSignal_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ProductionSignalConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionSignal" ADD CONSTRAINT "ProductionSignal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

