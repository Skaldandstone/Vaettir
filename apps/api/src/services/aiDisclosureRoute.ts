import type { FastifyInstance } from "fastify";
import { z } from "@vaettir/core/dist/validation.js";
import {
  AiDisclosureDenied,
  readAiProjectSummary,
  type AiReadStore,
} from "./aiDisclosureGateway.js";

export const AI_SUMMARY_PATH = "/integrations/ai/v1/project-summary";
const requestSchema = z
  .object({ projectId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/) })
  .strict();

// Registered only behind the deployment opt-in. No generic API/session fallback.
export function registerAiDisclosureRoute(
  server: FastifyInstance,
  store?: AiReadStore,
) {
  server.get(
    AI_SUMMARY_PATH,
    {
      logLevel: "silent",
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      reply.header("Pragma", "no-cache");
      if (!store)
        return reply.code(503).send({ error: "AI disclosure is unavailable." });
      const query = requestSchema.safeParse(request.query);
      const auth = request.headers.authorization;
      const token = auth?.match(/^Bearer (vai_[a-f0-9]{64})$/)?.[1];
      if (!query.success || !token) {
        server.log.warn(
          {
            securityEvent: {
              type: "ai_disclosure_denied",
              reason: "INVALID_REQUEST",
            },
          },
          "AI disclosure denied",
        );
        return reply
          .code(403)
          .send({ error: "AI disclosure is not permitted." });
      }
      try {
        return await readAiProjectSummary(store, token, query.data.projectId);
      } catch (error) {
        // Never log underlying exceptions: a driver or auth adapter may include
        // credentials, SQL parameters, or customer content in its error message.
        if (error instanceof AiDisclosureDenied) {
          server.log.warn(
            {
              securityEvent: {
                type: "ai_disclosure_denied",
                reason: "NOT_PERMITTED",
              },
            },
            "AI disclosure denied",
          );
          return reply
            .code(403)
            .send({ error: "AI disclosure is not permitted." });
        }
        server.log.warn(
          { securityEvent: { type: "ai_disclosure_unavailable" } },
          "AI disclosure unavailable",
        );
        return reply.code(503).send({ error: "AI disclosure is unavailable." });
      }
    },
  );
}
