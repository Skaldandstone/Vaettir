-- CreateTable
CREATE TABLE "ComplianceSignOffRequest" (
    "id" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "requestedForId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fulfilledAt" TIMESTAMP(3),
    "fulfilledSignOffId" TEXT,

    CONSTRAINT "ComplianceSignOffRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceSignOffRequest_fulfilledSignOffId_key" ON "ComplianceSignOffRequest"("fulfilledSignOffId");

-- CreateIndex
CREATE INDEX "ComplianceSignOffRequest_projectId_idx" ON "ComplianceSignOffRequest"("projectId");

-- CreateIndex
CREATE INDEX "ComplianceSignOffRequest_requestedForId_fulfilledAt_idx" ON "ComplianceSignOffRequest"("requestedForId", "fulfilledAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushToken_token_key" ON "PushToken"("token");

-- CreateIndex
CREATE INDEX "PushToken_userId_idx" ON "PushToken"("userId");

-- AddForeignKey
ALTER TABLE "ComplianceSignOffRequest" ADD CONSTRAINT "ComplianceSignOffRequest_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "ComplianceControl"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceSignOffRequest" ADD CONSTRAINT "ComplianceSignOffRequest_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceSignOffRequest" ADD CONSTRAINT "ComplianceSignOffRequest_requestedForId_fkey" FOREIGN KEY ("requestedForId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceSignOffRequest" ADD CONSTRAINT "ComplianceSignOffRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceSignOffRequest" ADD CONSTRAINT "ComplianceSignOffRequest_fulfilledSignOffId_fkey" FOREIGN KEY ("fulfilledSignOffId") REFERENCES "ComplianceSignOff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
