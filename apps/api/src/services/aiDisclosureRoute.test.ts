import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import {
  registerAiDisclosureRoute,
  AI_SUMMARY_PATH,
} from "./aiDisclosureRoute.js";
import type {
  AiReadGrant,
  AiReadStore,
  AiReadTransaction,
} from "./aiDisclosureGateway.js";

describe("AI read HTTP boundary (not production-registered)", () => {
  it("serializes only approved counts through the real HTTP handler", async () => {
    const grant: AiReadGrant = {
      id: "grant1",
      organizationId: "org1",
      projectId: "p1",
      principalId: "principal1",
      recipient: "codex",
      scope: "aggregate_counts",
      policyVersion: 1,
      classificationVersion: 1,
      expiresAt: new Date("2100-01-01T00:00:00Z"),
      revoked: false,
      enabled: true,
      organizationActive: true,
      principalActive: true,
      currentRole: "VIEWER",
      projectOrganizationId: "org1",
      projectClassification: "SYNTHETIC",
      projectClassificationVersion: 1,
      approvingAdminActive: true,
    };
    const audit = vi.fn(async () => {});
    const store: AiReadStore = {
      transaction: (work) =>
        work({
          resolveGrant: async () => grant,
          countProject: async () => ({
            testCases: 100,
            testPlans: 20,
            testRuns: 50,
            title: "CUSTOMER_SECRET",
          }),
          audit,
        }),
    };
    const app = Fastify();
    registerAiDisclosureRoute(app, store);
    try {
      const reply = await app.inject({
        url: AI_SUMMARY_PATH + "?projectId=p1",
        headers: { authorization: "Bearer vai_" + "a".repeat(64) },
      });
      expect(reply.statusCode).toBe(200);
      expect(reply.json()).toEqual({
        policyVersion: 1,
        disclosure: "aggregate_counts",
        classification: "SYNTHETIC",
        suppressed: false,
        counts: { testCases: 100, testPlans: 20, testRuns: 50 },
      });
      expect(reply.headers["cache-control"]).toBe("no-store");
      expect(audit).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });

  it("is disabled without a durable policy store", async () => {
    const app = Fastify();
    registerAiDisclosureRoute(app);
    try {
      const reply = await app.inject({
        url: AI_SUMMARY_PATH + "?projectId=p1",
      });
      expect(reply.statusCode).toBe(503);
      expect(reply.headers["cache-control"]).toBe("no-store");
    } finally {
      await app.close();
    }
  });

  it.each([
    {
      headers: { authorization: "Bearer vt_ordinary_key" },
      query: "projectId=p1",
    },
    {
      headers: { authorization: "Bearer human-session" },
      query: "projectId=p1",
    },
    {
      headers: { authorization: "Bearer vai_" + "a".repeat(64) },
      query: "projectId=p1&includeContent=true",
    },
  ])(
    "rejects fallback identities and unrecognized fields",
    async ({ headers, query }) => {
      const transaction = vi.fn();
      const app = Fastify();
      registerAiDisclosureRoute(app, { transaction });
      try {
        const reply = await app.inject({
          url: AI_SUMMARY_PATH + "?" + query,
          headers,
        });
        expect(reply.statusCode).toBe(403);
        expect(transaction).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    },
  );

  it("never serializes driver/adapter errors", async () => {
    const store: AiReadStore = {
      transaction: async <T>(
        _work: (tx: AiReadTransaction) => Promise<T>,
      ): Promise<T> => {
        throw new Error("PATIENT_CANARY CUSTOMER_SECRET vai_secret");
      },
    };
    const app = Fastify();
    registerAiDisclosureRoute(app, store);
    try {
      const reply = await app.inject({
        url: AI_SUMMARY_PATH + "?projectId=p1",
        headers: { authorization: "Bearer vai_" + "a".repeat(64) },
      });
      expect(reply.statusCode).toBe(503);
      expect(reply.body).toBe('{"error":"AI disclosure is unavailable."}');
    } finally {
      await app.close();
    }
  });
});
