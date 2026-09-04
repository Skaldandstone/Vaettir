import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, requireOrgRole } from "../trpc.js";
import { WEBHOOK_EVENT_TYPES, generateWebhookSecret, dispatchWebhookEvent } from "../services/webhookDelivery.js";
import { assertPublicHttpUrl, UnsafeUrlError } from "../services/urlGuard.js";

const eventTypeEnum = z.enum(WEBHOOK_EVENT_TYPES);

export const webhooksRouter = router({
  eventTypes: protectedProcedure.query(() => WEBHOOK_EVENT_TYPES),

  list: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          url: z.string(),
          eventTypes: z.array(z.string()),
          enabled: z.boolean(),
          createdAt: z.date(),
        }),
      ),
    )
    .query(({ ctx, input }) => {
      requireOrgRole(ctx, input.organizationId, "ADMIN");
      return ctx.prisma.webhookEndpoint.findMany({
        where: { organizationId: input.organizationId },
        select: { id: true, url: true, eventTypes: true, enabled: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      });
    }),

  // Secret is returned ONLY here, on creation - same write-once-visible
  // pattern as an invite token, since this is what the receiver uses to
  // verify signatures and there's no reason the API needs to display it
  // again after the admin has copied it down.
  create: protectedProcedure
    .input(z.object({ organizationId: z.string(), url: z.string().url(), eventTypes: z.array(eventTypeEnum).min(1) }))
    .output(z.object({ id: z.string(), secret: z.string() }))
    .mutation(async ({ ctx, input }) => {
      requireOrgRole(ctx, input.organizationId, "ADMIN");
      try {
        await assertPublicHttpUrl(input.url);
      } catch (err) {
        if (err instanceof UnsafeUrlError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
      const secret = generateWebhookSecret();
      const endpoint = await ctx.prisma.webhookEndpoint.create({
        data: {
          organizationId: input.organizationId,
          url: input.url,
          secret,
          eventTypes: input.eventTypes,
          createdById: ctx.user.id,
        },
      });
      return { id: endpoint.id, secret };
    }),

  update: protectedProcedure
    .input(z.object({ id: z.string(), eventTypes: z.array(eventTypeEnum).min(1), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const endpoint = await ctx.prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: input.id } });
      requireOrgRole(ctx, endpoint.organizationId, "ADMIN");
      return ctx.prisma.webhookEndpoint.update({
        where: { id: input.id },
        data: { eventTypes: input.eventTypes, enabled: input.enabled },
      });
    }),

  delete: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const endpoint = await ctx.prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: input.id } });
    requireOrgRole(ctx, endpoint.organizationId, "ADMIN");
    await ctx.prisma.webhookEndpoint.delete({ where: { id: input.id } });
    return { deleted: true };
  }),

  listDeliveries: protectedProcedure
    .input(z.object({ webhookEndpointId: z.string() }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          eventType: z.string(),
          success: z.boolean(),
          responseStatus: z.number().nullable(),
          error: z.string().nullable(),
          createdAt: z.date(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      const endpoint = await ctx.prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: input.webhookEndpointId } });
      requireOrgRole(ctx, endpoint.organizationId, "ADMIN");
      return ctx.prisma.webhookDelivery.findMany({
        where: { webhookEndpointId: input.webhookEndpointId },
        orderBy: { createdAt: "desc" },
        take: 25,
      });
    }),

  // "Test this endpoint" - fires a real delivery through the exact same
  // dispatchWebhookEvent path a real event uses (using one of the
  // endpoint's own subscribed event types, so dispatch's own
  // eventTypes-filtered query actually includes it), so what an admin sees
  // here is proof the real thing works, not a simulation of it.
  sendTest: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const endpoint = await ctx.prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: input.id } });
    requireOrgRole(ctx, endpoint.organizationId, "ADMIN");
    if (!endpoint.enabled) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Endpoint is disabled" });
    }

    const testEventType = endpoint.eventTypes[0] ?? "risk_flag.created";
    await dispatchWebhookEvent(ctx.prisma, endpoint.organizationId, testEventType as never, {
      test: true,
      message: "This is a test delivery from Vaettir's webhook settings.",
    });

    const latest = await ctx.prisma.webhookDelivery.findFirst({
      where: { webhookEndpointId: endpoint.id },
      orderBy: { createdAt: "desc" },
    });
    return latest;
  }),
});
