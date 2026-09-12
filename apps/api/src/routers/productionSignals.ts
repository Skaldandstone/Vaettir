import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { tierHasFeature, FEATURE_PRODUCTION_SIGNAL_LINKAGE } from "@vaettir/core";
import { router, protectedProcedure, requireProjectAccess, type Context } from "../trpc.js";
import {
  buildGooglePlayAuthorizeUrl,
  generateOAuthState,
  validateAppleAppStoreCredentials,
  ProductionSignalOAuthNotConfiguredError,
} from "../services/productionSignalOAuth.js";
import { encryptToken, TokenEncryptionNotConfiguredError } from "../services/tokenEncryption.js";

// SSE-180: production-signal linkage. Gated behind P12-07's tierHasFeature
// plumbing (Business/Corp only, see seed.ts) AND project ADMIN - a heavier
// bar than most routers here, since this is the first feature that lets an
// org grant Vaettir standing access to their own app-store account.
async function requireProductionSignalAccess(
  ctx: { prisma: Context["prisma"]; user: NonNullable<Context["user"]> },
  projectId: string,
) {
  const { project, membership } = await requireProjectAccess(ctx, projectId, "ADMIN");
  const org = await ctx.prisma.organization.findUniqueOrThrow({
    where: { id: project.organizationId },
    select: { planTier: { select: { enabledFeatures: true } } },
  });
  if (!tierHasFeature(org.planTier, FEATURE_PRODUCTION_SIGNAL_LINKAGE)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Production-signal linkage requires a Business or Corp plan.",
    });
  }
  return { project, membership };
}

export const productionSignalsRouter = router({
  // GOOGLE_PLAY only - Apple has no equivalent redirect flow, see
  // connectAppleAppStore below and services/productionSignalOAuth.ts's
  // file-level comment on why the two providers differ this much.
  startGooglePlayConnect: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireProductionSignalAccess(ctx, input.projectId);
      const state = generateOAuthState();
      let authorizeUrl: string;
      try {
        authorizeUrl = buildGooglePlayAuthorizeUrl(state);
      } catch (e) {
        if (e instanceof ProductionSignalOAuthNotConfiguredError) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: e.message });
        }
        throw e;
      }
      // Upserted, not created fresh each time: a re-connect attempt (e.g.
      // after an expired/abandoned first try) replaces the old state rather
      // than leaving two PENDING rows racing each other.
      await ctx.prisma.productionSignalConnection.upsert({
        where: { projectId_provider: { projectId: input.projectId, provider: "GOOGLE_PLAY" } },
        create: {
          projectId: input.projectId,
          provider: "GOOGLE_PLAY",
          status: "PENDING",
          oauthState: state,
          connectedByUserId: ctx.user.id,
        },
        update: { status: "PENDING", oauthState: state, lastSyncError: null, connectedByUserId: ctx.user.id },
      });
      return { authorizeUrl };
    }),

  // APPLE_APP_STORE only - no redirect, the customer pastes in an API key
  // they generated themselves in App Store Connect. Validated (does it
  // parse as an EC key, does it actually sign) before it's ever stored.
  connectAppleAppStore: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        issuerId: z.string().min(1),
        keyId: z.string().min(1),
        privateKeyPem: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireProductionSignalAccess(ctx, input.projectId);

      try {
        validateAppleAppStoreCredentials({
          issuerId: input.issuerId,
          keyId: input.keyId,
          privateKeyPem: input.privateKeyPem,
        });
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : "Invalid App Store Connect credentials.",
        });
      }

      let encrypted;
      try {
        encrypted = encryptToken(JSON.stringify({ privateKeyPem: input.privateKeyPem }));
      } catch (e) {
        if (e instanceof TokenEncryptionNotConfiguredError) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: e.message });
        }
        throw e;
      }

      await ctx.prisma.productionSignalConnection.upsert({
        where: { projectId_provider: { projectId: input.projectId, provider: "APPLE_APP_STORE" } },
        create: {
          projectId: input.projectId,
          provider: "APPLE_APP_STORE",
          status: "CONNECTED",
          appleIssuerId: input.issuerId,
          appleKeyId: input.keyId,
          encryptedCredentials: encrypted.ciphertext,
          credentialsIv: encrypted.iv,
          credentialsAuthTag: encrypted.authTag,
          connectedByUserId: ctx.user.id,
          connectedAt: new Date(),
        },
        update: {
          status: "CONNECTED",
          appleIssuerId: input.issuerId,
          appleKeyId: input.keyId,
          encryptedCredentials: encrypted.ciphertext,
          credentialsIv: encrypted.iv,
          credentialsAuthTag: encrypted.authTag,
          connectedByUserId: ctx.user.id,
          connectedAt: new Date(),
          lastSyncError: null,
        },
      });
      return { connected: true };
    }),

  // Deliberately never returns a token field, encrypted or otherwise - just
  // enough to render "Connected as Issuer ABC" / "Not connected" in the UI.
  listConnections: protectedProcedure.input(z.object({ projectId: z.string() })).query(async ({ ctx, input }) => {
    await requireProjectAccess(ctx, input.projectId, "VIEWER");
    return ctx.prisma.productionSignalConnection.findMany({
      where: { projectId: input.projectId },
      select: {
        id: true,
        provider: true,
        status: true,
        externalAccountId: true,
        appleIssuerId: true,
        appleKeyId: true,
        connectedAt: true,
        lastSyncedAt: true,
        lastSyncError: true,
      },
    });
  }),

  // Deliberately reachable at plain ADMIN (not gated on the feature flag
  // still being active) - a downgraded org must still be able to revoke a
  // connection it granted while on a higher tier.
  disconnect: protectedProcedure
    .input(z.object({ projectId: z.string(), provider: z.enum(["GOOGLE_PLAY", "APPLE_APP_STORE"]) }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "ADMIN");
      await ctx.prisma.productionSignalConnection.updateMany({
        where: { projectId: input.projectId, provider: input.provider },
        data: {
          status: "DISCONNECTED",
          encryptedCredentials: null,
          credentialsIv: null,
          credentialsAuthTag: null,
          oauthState: null,
          appleIssuerId: null,
          appleKeyId: null,
          scope: null,
          externalAccountId: null,
        },
      });
      return { disconnected: true };
    }),

  // Signals themselves are already PII-minimized at ingest time (see the
  // ProductionSignal schema comment) - nothing further to redact here.
  listSignals: protectedProcedure
    .input(z.object({ projectId: z.string(), limit: z.number().min(1).max(200).default(50) }))
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "VIEWER");
      return ctx.prisma.productionSignal.findMany({
        where: { projectId: input.projectId },
        orderBy: { occurredAt: "desc" },
        take: input.limit,
        select: { id: true, type: true, summary: true, occurredAt: true, createdAt: true },
      });
    }),
});
