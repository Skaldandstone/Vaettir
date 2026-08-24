-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('OWNER', 'ADMIN', 'EDITOR', 'VIEWER', 'COMPLIANCE_AUDITOR');

-- CreateEnum
CREATE TYPE "SeatType" AS ENUM ('FULL', 'READ_ONLY');

-- CreateEnum
CREATE TYPE "TestPlanCategory" AS ENUM ('FUNCTIONAL', 'QUALITY_STRATEGY', 'COMPLIANCE', 'RELEASE_READINESS', 'CUSTOM');

-- CreateEnum
CREATE TYPE "TestPlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'IN_REVIEW', 'APPROVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AcceptanceCriterionStatus" AS ENUM ('PENDING', 'MET', 'NOT_MET', 'AT_RISK');

-- CreateEnum
CREATE TYPE "TestCaseType" AS ENUM ('UNIT', 'FUNCTIONAL', 'CONTRACT', 'INSTRUMENTATION', 'SMOKE', 'SANITY', 'REGRESSION', 'E2E', 'PERFORMANCE', 'SECURITY', 'ACCESSIBILITY', 'EXPLORATORY', 'COMPLIANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "AutomationStatus" AS ENUM ('MANUAL', 'AUTOMATED', 'PARTIALLY_AUTOMATED', 'NEEDS_AUTOMATION');

-- CreateEnum
CREATE TYPE "TestCasePriority" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "TestCaseOrigin" AS ENUM ('AUTHORED', 'AI_REVERSE_ENGINEERED', 'IMPORTED');

-- CreateEnum
CREATE TYPE "FrameworkFamily" AS ENUM ('JEST', 'VITEST', 'MOCHA', 'PYTEST', 'JUNIT', 'TESTNG', 'RSPEC', 'GO_TEST', 'CYPRESS', 'PLAYWRIGHT', 'SELENIUM', 'APPIUM', 'POSTMAN', 'PACT', 'ROBOT_FRAMEWORK', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ReverseEngineerInputType" AS ENUM ('PASTE', 'FILE_UPLOAD', 'REPO_SCAN', 'CI_UNMATCHED_RESULT');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "TestRunStatus" AS ENUM ('RUNNING', 'PASSED', 'FAILED', 'PARTIAL');

-- CreateEnum
CREATE TYPE "TestResultArtifactType" AS ENUM ('SCREENSHOT', 'VIDEO');

-- CreateEnum
CREATE TYPE "TestResultStatus" AS ENUM ('PASS', 'FAIL', 'SKIP', 'FLAKY');

-- CreateEnum
CREATE TYPE "ReleaseStatus" AS ENUM ('PLANNING', 'IN_TESTING', 'READY', 'SHIPPED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "RiskSeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "RiskSource" AS ENUM ('PR_SCAN_COVERAGE_GAP', 'FAILING_TEST', 'FLAKY_TEST', 'MANUAL_FLAG', 'MISSING_COMPLIANCE_CONTROL');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "planTierId" TEXT NOT NULL,
    "dataRetentionYears" INTEGER NOT NULL DEFAULT 5,
    "stepFieldLabels" JSONB,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "repoUrl" TEXT,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "clerkUserId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL,
    "seatType" "SeatType" NOT NULL DEFAULT 'FULL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanTier" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "minFullSeats" INTEGER NOT NULL,
    "maxFullSeats" INTEGER,
    "includedReadOnlySeats" INTEGER NOT NULL DEFAULT 0,
    "maxReadOnlySeats" INTEGER,
    "monthlyPricePerSeatCents" INTEGER,

    CONSTRAINT "PlanTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestPlanType" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "TestPlanCategory" NOT NULL,
    "description" TEXT,
    "fieldSchema" JSONB NOT NULL,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestPlanType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestPlan" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "testPlanTypeId" TEXT NOT NULL,
    "releaseId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "TestPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Requirement" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "externalRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Requirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcceptanceCriterion" (
    "id" TEXT NOT NULL,
    "testPlanId" TEXT NOT NULL,
    "requirementId" TEXT,
    "description" TEXT NOT NULL,
    "status" "AcceptanceCriterionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AcceptanceCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestCase" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "testPlanId" TEXT,
    "testPlanTypeId" TEXT,
    "title" TEXT NOT NULL,
    "background" TEXT,
    "given" TEXT[],
    "when" TEXT[],
    "then" TEXT[],
    "tags" TEXT[],
    "priority" "TestCasePriority" NOT NULL DEFAULT 'MEDIUM',
    "testType" "TestCaseType" NOT NULL,
    "automationStatus" "AutomationStatus" NOT NULL DEFAULT 'MANUAL',
    "origin" "TestCaseOrigin" NOT NULL DEFAULT 'AUTHORED',
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestCaseStep" (
    "id" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "expectedActionOrData" TEXT,
    "expectedResult" TEXT,
    "expectedResponse" TEXT,

    CONSTRAINT "TestCaseStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestCaseSource" (
    "id" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "repoUrl" TEXT,
    "filePath" TEXT NOT NULL,
    "functionName" TEXT,
    "framework" TEXT NOT NULL,
    "frameworkFamily" "FrameworkFamily" NOT NULL DEFAULT 'CUSTOM',
    "lastSyncedCommitSha" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "externalTestId" TEXT,

    CONSTRAINT "TestCaseSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReverseEngineerJob" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "inputType" "ReverseEngineerInputType" NOT NULL,
    "inputRef" TEXT NOT NULL,
    "framework" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "triggeringResultId" TEXT,
    "resultTestCaseIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ReverseEngineerJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceFramework" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT,
    "description" TEXT,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ComplianceFramework_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceControl" (
    "id" TEXT NOT NULL,
    "frameworkId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "ComplianceControl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestCaseComplianceControl" (
    "testCaseId" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,

    CONSTRAINT "TestCaseComplianceControl_pkey" PRIMARY KEY ("testCaseId","controlId")
);

-- CreateTable
CREATE TABLE "TestRun" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ciProvider" TEXT NOT NULL,
    "ciRunUrl" TEXT,
    "commitSha" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "status" "TestRunStatus" NOT NULL DEFAULT 'RUNNING',

    CONSTRAINT "TestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestResult" (
    "id" TEXT NOT NULL,
    "testRunId" TEXT NOT NULL,
    "testCaseId" TEXT,
    "externalTestId" TEXT,
    "externalFilePath" TEXT,
    "status" "TestResultStatus" NOT NULL,
    "durationMs" INTEGER,
    "errorMessage" TEXT,

    CONSTRAINT "TestResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestResultArtifact" (
    "id" TEXT NOT NULL,
    "testResultId" TEXT NOT NULL,
    "type" "TestResultArtifactType" NOT NULL,
    "storageUrl" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMs" INTEGER,

    CONSTRAINT "TestResultArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Release" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetDate" TIMESTAMP(3),
    "status" "ReleaseStatus" NOT NULL DEFAULT 'PLANNING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Release_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskFlag" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "severity" "RiskSeverity" NOT NULL,
    "source" "RiskSource" NOT NULL,
    "description" TEXT NOT NULL,
    "relatedFilePath" TEXT,
    "relatedPrUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "RiskFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Project_organizationId_slug_key" ON "Project"("organizationId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_clerkUserId_key" ON "User"("clerkUserId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Membership_organizationId_seatType_idx" ON "Membership"("organizationId", "seatType");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_organizationId_userId_key" ON "Membership"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanTier_key_key" ON "PlanTier"("key");

-- CreateIndex
CREATE UNIQUE INDEX "TestPlanType_key_key" ON "TestPlanType"("key");

-- CreateIndex
CREATE INDEX "TestCaseStep_testCaseId_idx" ON "TestCaseStep"("testCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "TestCaseStep_testCaseId_order_key" ON "TestCaseStep"("testCaseId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "TestCaseSource_testCaseId_key" ON "TestCaseSource"("testCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "TestCaseSource_externalTestId_key" ON "TestCaseSource"("externalTestId");

-- CreateIndex
CREATE INDEX "TestCaseSource_framework_idx" ON "TestCaseSource"("framework");

-- CreateIndex
CREATE UNIQUE INDEX "ReverseEngineerJob_triggeringResultId_key" ON "ReverseEngineerJob"("triggeringResultId");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceFramework_key_key" ON "ComplianceFramework"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceControl_frameworkId_code_key" ON "ComplianceControl"("frameworkId", "code");

-- CreateIndex
CREATE INDEX "TestResult_testRunId_idx" ON "TestResult"("testRunId");

-- CreateIndex
CREATE INDEX "TestResult_testCaseId_idx" ON "TestResult"("testCaseId");

-- CreateIndex
CREATE INDEX "TestResultArtifact_testResultId_idx" ON "TestResultArtifact"("testResultId");

-- AddForeignKey
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_planTierId_fkey" FOREIGN KEY ("planTierId") REFERENCES "PlanTier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestPlan" ADD CONSTRAINT "TestPlan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestPlan" ADD CONSTRAINT "TestPlan_testPlanTypeId_fkey" FOREIGN KEY ("testPlanTypeId") REFERENCES "TestPlanType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestPlan" ADD CONSTRAINT "TestPlan_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcceptanceCriterion" ADD CONSTRAINT "AcceptanceCriterion_testPlanId_fkey" FOREIGN KEY ("testPlanId") REFERENCES "TestPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcceptanceCriterion" ADD CONSTRAINT "AcceptanceCriterion_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_testPlanId_fkey" FOREIGN KEY ("testPlanId") REFERENCES "TestPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_testPlanTypeId_fkey" FOREIGN KEY ("testPlanTypeId") REFERENCES "TestPlanType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCaseStep" ADD CONSTRAINT "TestCaseStep_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCaseSource" ADD CONSTRAINT "TestCaseSource_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReverseEngineerJob" ADD CONSTRAINT "ReverseEngineerJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReverseEngineerJob" ADD CONSTRAINT "ReverseEngineerJob_triggeringResultId_fkey" FOREIGN KEY ("triggeringResultId") REFERENCES "TestResult"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceControl" ADD CONSTRAINT "ComplianceControl_frameworkId_fkey" FOREIGN KEY ("frameworkId") REFERENCES "ComplianceFramework"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCaseComplianceControl" ADD CONSTRAINT "TestCaseComplianceControl_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCaseComplianceControl" ADD CONSTRAINT "TestCaseComplianceControl_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "ComplianceControl"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestResult" ADD CONSTRAINT "TestResult_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "TestRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestResult" ADD CONSTRAINT "TestResult_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "TestCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestResultArtifact" ADD CONSTRAINT "TestResultArtifact_testResultId_fkey" FOREIGN KEY ("testResultId") REFERENCES "TestResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Release" ADD CONSTRAINT "Release_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskFlag" ADD CONSTRAINT "RiskFlag_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
