-- AlterTable
ALTER TABLE "PlanTier" ADD COLUMN     "enabledFeatures" TEXT[] DEFAULT ARRAY[]::TEXT[];
