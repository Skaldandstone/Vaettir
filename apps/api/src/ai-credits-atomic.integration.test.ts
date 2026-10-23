import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@vaettir/ai-agent", async (original) => ({
  ...(await original<typeof import("@vaettir/ai-agent")>()),
  captureAiUsage: vi.fn(async (fn: () => Promise<unknown>) => ({
    result: await fn(),
    usage: {
      calls: 1,
      inputTokens: 100000,
      outputTokens: 0,
      model: "synthetic-no-provider",
    },
  })),
}));
import { captureAiUsage } from "@vaettir/ai-agent";
import { prisma } from "@vaettir/db";
import {
  chargeAiCredits,
  getAiCreditBalance,
  meterAiCall,
} from "./services/aiCredits.js";
import {
  ApprovedAnalysisSpendRefusal,
  withApprovedAnalysisSpend,
  type ApprovedAnalysisSpend,
} from "./services/approvedAnalysisSpend.js";
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const isolated =
  url &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  /test/i.test(url.pathname) &&
  !url.searchParams.has("host");
describe.skipIf(!isolated)(
  "atomic credit debit and approved queue caps",
  () => {
    let organizationId: string;
    beforeAll(async () => {
      const key = `credit-atomic-${Date.now()}`;
      const tier = await prisma.planTier.findUniqueOrThrow({
        where: { key: "free" },
      });
      organizationId = (
        await prisma.organization.create({
          data: { name: key, slug: key, planTierId: tier.id },
        })
      ).id;
    });
    afterAll(async () => {
      await prisma.aiCreditTransaction.deleteMany({
        where: { organizationId },
      });
      await prisma.organization.delete({ where: { id: organizationId } });
    });
    async function grant(amount: number) {
      await prisma.aiCreditTransaction.create({
        data: {
          organizationId,
          type: "GRANT",
          amount,
          description: "Synthetic atomic ledger fixture",
        },
      });
    }
    function scope(
      overrides: Partial<ApprovedAnalysisSpend> = {},
    ): ApprovedAnalysisSpend {
      return {
        organizationId,
        caseId: "synthetic",
        inputHash: "0".repeat(64),
        operation: "assessTestCaseRisk",
        maximumCredits: 2,
        validate: async () => {},
        recordCharge: async () => {},
        recordMeter: async () => true,
        ...overrides,
      };
    }
    it("serializes concurrent affordability reads without negative balance", async () => {
      await grant(10);
      const outcomes = await Promise.allSettled(
        Array.from({ length: 12 }, () =>
          chargeAiCredits(prisma, organizationId, "assessTestCaseRisk"),
        ),
      );
      expect(
        outcomes.filter((value) => value.status === "fulfilled"),
      ).toHaveLength(5);
      expect(
        outcomes.filter((value) => value.status === "rejected"),
      ).toHaveLength(7);
      expect(await getAiCreditBalance(prisma, organizationId)).toBe(0);
      expect(
        await prisma.aiCreditTransaction.count({
          where: { organizationId, type: "CONSUMPTION" },
        }),
      ).toBe(5);
    });
    it("reuses an existing transaction and rolls back debit with the enclosing operation", async () => {
      await grant(20);
      const before = await getAiCreditBalance(prisma, organizationId);
      await expect(
        prisma.$transaction(async (tx) => {
          await chargeAiCredits(
            tx as unknown as typeof prisma,
            organizationId,
            "assessTestCaseRisk",
          );
          throw new Error("Synthetic enclosing rollback");
        }),
      ).rejects.toThrow("Synthetic enclosing rollback");
      expect(await getAiCreditBalance(prisma, organizationId)).toBe(before);
    });
    it("commits the queue charge receipt atomically or rolls back both", async () => {
      const before = await getAiCreditBalance(prisma, organizationId);
      const approved = scope({
        recordCharge: async () => {
          throw new Error("Synthetic queue receipt unavailable");
        },
      });
      await expect(
        withApprovedAnalysisSpend(approved, () =>
          chargeAiCredits(prisma, organizationId, "assessTestCaseRisk"),
        ),
      ).rejects.toThrow("Synthetic queue receipt unavailable");
      expect(approved.chargeId).toBeUndefined();
      expect(await getAiCreditBalance(prisma, organizationId)).toBe(before);
    });
    it("refuses cancelled or mismatched approval before ledger debit", async () => {
      const before = await getAiCreditBalance(prisma, organizationId);
      await expect(
        withApprovedAnalysisSpend(
          scope({
            validate: async () => {
              throw new ApprovedAnalysisSpendRefusal(
                "CANCELLED",
                "Cancelled before charge",
              );
            },
          }),
          () => chargeAiCredits(prisma, organizationId, "assessTestCaseRisk"),
        ),
      ).rejects.toMatchObject({
        definitiveNoCharge: true,
        reason: "CANCELLED",
      });
      await expect(
        withApprovedAnalysisSpend(scope({ maximumCredits: 1 }), () =>
          chargeAiCredits(prisma, organizationId, "assessTestCaseRisk"),
        ),
      ).rejects.toMatchObject({ definitiveNoCharge: true, reason: "BUDGET" });
      expect(await getAiCreditBalance(prisma, organizationId)).toBe(before);
    });
    it("retains measured excess without debiting above the approved maximum", async () => {
      const approved = scope({ recordMeter: vi.fn(async () => true) });
      const before = await getAiCreditBalance(prisma, organizationId);
      await withApprovedAnalysisSpend(approved, async () => {
        const charge = await chargeAiCredits(
          prisma,
          organizationId,
          "assessTestCaseRisk",
        );
        expect(
          await meterAiCall(
            prisma,
            charge,
            async () => "saved synthetic result",
          ),
        ).toBe("saved synthetic result");
        expect(
          await prisma.aiCreditTransaction.findUniqueOrThrow({
            where: { id: charge.transactionId },
          }),
        ).toMatchObject({ inputTokens: 100000, aiCalls: 1, amount: -2 });
      });
      expect(approved.recordMeter).toHaveBeenCalledWith(
        expect.anything(),
        approved.chargeId,
        { actualCredits: 30, refund: 0, excessNotCharged: 28 },
      );
      expect(await getAiCreditBalance(prisma, organizationId)).toBe(before - 2);
    });
    it("reconciles a refund once without duplicate adjustment on repeated metering", async () => {
      vi.mocked(captureAiUsage).mockImplementation(async (fn) => ({
        result: await fn(),
        usage: {
          calls: 1,
          inputTokens: 100,
          outputTokens: 0,
          model: "synthetic-no-provider",
        },
      }));
      let metered = false;
      const approved = scope({
        recordMeter: async () => {
          if (metered) return false;
          metered = true;
          return true;
        },
      });
      const before = await getAiCreditBalance(prisma, organizationId);
      await withApprovedAnalysisSpend(approved, async () => {
        const charge = await chargeAiCredits(
          prisma,
          organizationId,
          "assessTestCaseRisk",
        );
        await meterAiCall(prisma, charge, async () => "synthetic result");
        await meterAiCall(prisma, charge, async () => "same synthetic result");
      });
      expect(await getAiCreditBalance(prisma, organizationId)).toBe(before - 1);
      expect(
        await prisma.aiCreditTransaction.count({
          where: {
            organizationId,
            type: "ADJUSTMENT",
            description: { contains: approved.chargeId! },
          },
        }),
      ).toBe(1);
    });
  },
);
