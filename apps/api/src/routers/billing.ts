import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router, staffTokenProcedure } from "../trpc.js";
import { getBillingRuntime, type BillingRuntime } from "../services/stripeConfig.js";
import { billingStatus, createCheckout, createPortal, enrollBillingTest } from "../services/stripeBilling.js";

// Never forward provider responses, configuration paths or customer payloads to
// clients or the generic tRPC exception reporter.
async function safe<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error) {
    if (error instanceof TRPCError) throw error;
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Billing is unavailable. Retry later or contact support." });
  }
}
const organization = z.object({ organizationId: z.string().min(1).max(100) }).strict();

export function createBillingRouter(runtimeProvider: () => BillingRuntime | null = getBillingRuntime) {
  function required() {
    const runtime = runtimeProvider();
    if (!runtime) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Billing is disabled. Private beta has no paid checkout." });
    return runtime;
  }
  return router({
    status: protectedProcedure.input(organization).query(({ ctx, input }) => safe(() => billingStatus(ctx.prisma, runtimeProvider(), input.organizationId, ctx.user.id))),
    checkout: protectedProcedure.input(organization.extend({ planKey: z.enum(["team", "business", "corp"]), fullSeats: z.number().int().min(1).max(10000) }).strict())
      .mutation(({ ctx, input }) => safe(() => createCheckout(ctx.prisma, required(), ctx.user.id, input))),
    portal: protectedProcedure.input(organization).mutation(({ ctx, input }) => safe(() => createPortal(ctx.prisma, required(), input.organizationId, ctx.user.id))),
    enrollTest: staffTokenProcedure.input(organization.extend({ reason: z.string().trim().min(8).max(500) }).strict())
      .mutation(({ ctx, input }) => safe(() => enrollBillingTest(ctx.prisma, required(), input.organizationId, ctx.staff.actor, input.reason))),
  });
}
export const billingRouter = createBillingRouter();
