import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@vaettir/db";
import { z } from "@vaettir/core/dist/validation.js";
import {
  verifyForgeInvocation,
  verifyForgeViewer,
  verifyForgeEventInvocation,
  readForgeJiraVersion,
} from "./forgeInvocation.js";
import {
  forgeQualityBinding,
  readSharedQuality,
  listForgeSharing,
} from "./atlassianQualitySharing.js";
import { readJiraTicketVerification } from "./jiraTicketVerification.js";
import { issueForgeConnectionRequest, readForgeConnectionTarget } from "./forgeConnectionRequest.js";
import { authorizeForgeSharing } from "./atlassianQualitySharing.js";
import {
  captureJiraRelease,
  releaseEventConnections,
  readJiraReleaseQuality,
  readSharedClosure,
  publicReleaseEvidence,
} from "./jiraReleaseEvidence.js";

import { readForgeLiveQuality } from "./forgeLiveQuality.js";

const input = z.discriminatedUnion("action", [
  z.object({ action: z.literal("IDENTITY") }).strict(),
  z.object({ action: z.literal("CONNECT") }).strict(),
  z.object({ action: z.literal("LIST") }).strict(),
  z.object({ action: z.literal("READ_LIVE"), connectionKey: z.string().regex(/^forge-sharing-[a-f0-9]{64}$/) }).strict(),
  z
    .object({
      action: z.literal("RELEASES"),
      connectionKey: z.string().regex(/^forge-sharing-[a-f0-9]{64}$/),
    })
    .strict(),
  z
    .object({
      action: z.literal("READ_RELEASE"),
      connectionKey: z.string().regex(/^forge-sharing-[a-f0-9]{64}$/),
      versionId: z.string().regex(/^\d{1,40}$/),
    })
    .strict(),
  z
    .object({
      action: z.literal("READ_CLOSURE"),
      connectionKey: z.string().regex(/^forge-sharing-[a-f0-9]{64}$/),
      closureId: z.string().length(64),
    })
    .strict(),
  z
    .object({
      action: z.literal("READ"),
      connectionKey: z.string().regex(/^forge-sharing-[a-f0-9]{64}$/),
      snapshotId: z.string().length(64).optional(),
    })
    .strict(),
]);
export function registerForgeQualityRoute(
  server: FastifyInstance,
  prisma: PrismaClient,
) {
  server.post(
    "/api/integrations/forge/quality",
    { bodyLimit: 16000 },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store, private");
      const appId = process.env.VAETTIR_FORGE_APP_ID,
        environmentId = process.env.VAETTIR_FORGE_ENVIRONMENT_ID;
      if (!appId || !environmentId)
        return reply.code(503).send({
          error:
            "The Vaettir Atlassian app is not enabled on this deployment yet.",
        });
      const parsed = input.safeParse(request.body);
      if (!parsed.success)
        return reply
          .code(400)
          .send({ error: "Choose a valid quality snapshot request." });
      try {
        const authorization = request.headers.authorization,
          userToken = request.headers["x-forge-oauth-user"];
        if (
          !authorization?.startsWith("Bearer ") ||
          typeof userToken !== "string"
        )
          return reply
            .code(401)
            .send({ error: "Forge user authorization is required." });
        const identity = await verifyForgeViewer(
          await verifyForgeInvocation(
            authorization.slice(7),
            appId,
            environmentId,
          ),
          userToken,
        );
        if (parsed.data.action === "CONNECT")
          return issueForgeConnectionRequest(identity, await readForgeConnectionTarget(identity, userToken));
        if (parsed.data.action === "IDENTITY") {
          const {
            appId,
            installationId,
            environmentId,
            cloudId,
            siteOrigin,
            product,
            targetId,
          } = identity;
          return {
            binding: forgeQualityBinding.parse({
              appId,
              installationId,
              environmentId,
              cloudId,
              siteOrigin,
              product,
              targetId,
            }),
            notice:
              "An administrator must explicitly approve quality sharing to this Jira project or Confluence space in Vaettir. No source or architecture mapping is shared.",
          };
        }
        if (parsed.data.action === "LIST")
          return await prisma.$transaction(
            (tx) => listForgeSharing(tx, identity),
            { timeout: 15000, isolationLevel: "ReadCommitted" },
          );
        const value = parsed.data;
        if (value.action === "READ_RELEASE") {
          if (identity.moduleKey !== "vaettir-project-quality")
            throw new Error("Release views require project context");
          // Do not send an OAuth token to an unapproved project's version.
          await prisma.$transaction((tx) =>
            authorizeForgeSharing(tx, value.connectionKey, identity),
          );
          const version = await readForgeJiraVersion(
            identity,
            userToken,
            value.versionId,
          );
          return publicReleaseEvidence(
            await prisma.$transaction(
              (tx) =>
                readJiraReleaseQuality(
                  tx,
                  value.connectionKey,
                  identity,
                  version,
                ),
              { timeout: 15000, isolationLevel: "ReadCommitted" },
            ),
          );
        }
        const { connectionKey } = value;
        return await prisma.$transaction(
          async (tx) => {
            if (value.action === "READ_CLOSURE")
              return publicReleaseEvidence(
                await readSharedClosure(
                  tx,
                  connectionKey,
                  identity,
                  value.closureId,
                ),
              );
            if (value.action === "RELEASES") {
              const { sharing, projectId } = await authorizeForgeSharing(
                tx,
                connectionKey,
                identity,
              );
              const releases = await tx.release.findMany({
                where: {
                  projectId,
                  id: { in: sharing.releaseLinks.map((l) => l.releaseId) },
                },
                select: { id: true, name: true },
              });
              return {
                releases:
                  identity.product === "jira"
                    ? sharing.releaseLinks.map((l) => ({
                        versionId: l.jiraVersionId,
                        releaseId: l.releaseId,
                        name:
                          releases.find((r) => r.id === l.releaseId)?.name ??
                          "Unavailable linked release",
                      }))
                    : [],
                closureIds: sharing.closureSnapshotIds,
              };
            }
            if (value.action === "READ_LIVE") return readForgeLiveQuality(tx, connectionKey, identity);
            if (identity.moduleKey === "vaettir-issue-quality")
              return await readJiraTicketVerification(
                tx,
                connectionKey,
                identity,
              );
            return await readSharedQuality(
              tx,
              connectionKey,
              identity,
              value.action === "READ" ? value.snapshotId : undefined,
            );
          },
          { timeout: 15000, isolationLevel: "ReadCommitted" },
        );
      } catch {
        // Tokens and upstream response bodies must not reach logs or telemetry.
        return reply.code(403).send({
          error:
            "Quality sharing or current page/project access could not be verified. Review the connection in Vaettir.",
        });
      }
    },
  );
  server.post(
    "/api/integrations/forge/release-event",
    { bodyLimit: 4000 },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store, private");
      const appId = process.env.VAETTIR_FORGE_APP_ID,
        environmentId = process.env.VAETTIR_FORGE_ENVIRONMENT_ID;
      if (!appId || !environmentId)
        return reply
          .code(503)
          .send({ error: "Forge release capture is not enabled" });
      const event = z
        .object({
          eventType: z.literal("avi:jira:released:version"),
          versionId: z.string().regex(/^\d{1,40}$/),
          observedAt: z.string().datetime(),
        })
        .strict()
        .safeParse(request.body);
      if (!event.success)
        return reply.code(400).send({ error: "Invalid release event" });
      try {
        const authorization = request.headers.authorization,
          systemToken = request.headers["x-forge-oauth-system"];
        if (
          !authorization?.startsWith("Bearer ") ||
          typeof systemToken !== "string"
        )
          return reply
            .code(401)
            .send({ error: "Backend Forge authorization required" });
        const identity = await verifyForgeEventInvocation(
          authorization.slice(7),
          appId,
          environmentId,
        );
        const version = await readForgeJiraVersion(
          identity,
          systemToken,
          event.data.versionId,
        );
        if (!version.released)
          return {
            captured: 0,
            notice:
              "Version is no longer Released; no historical metrics were invented.",
          };
        const connections = await prisma.$transaction((tx) =>
          releaseEventConnections(tx, identity, version),
        );
        // Each completed project capture survives another project's failure and
        // is recovered without replacement on the durable Forge queue's retry.
        let captured = 0;
        for (const c of connections) {
          const result = await prisma.$transaction(
            (tx) =>
              captureJiraRelease(
                tx,
                c.key,
                c.identity,
                version,
                event.data.observedAt,
              ),
            { timeout: 15000, isolationLevel: "ReadCommitted" },
          );
          if (result.captured) captured++;
        }
        return { captured };
      } catch {
        // Non-2xx makes the durable consumer retry; never return a success for a
        // failed capture or leak access tokens, cases, or upstream responses.
        return reply
          .code(503)
          .send({ error: "Release capture unconfirmed; retry required" });
      }
    },
  );
}
