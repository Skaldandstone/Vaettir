import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { Context } from "../trpc.js";
const calls = vi.hoisted(() => ({
  access: vi.fn(),
  preview: vi.fn(),
  transaction: vi.fn(),
  verify: vi.fn(),
  mirror: vi.fn(),
  start: vi.fn(),
}));
vi.mock("../services/manualRunStartReviewedRead.js", () => ({
  readManualRunStartReviewedAccess: calls.access,
  readManualRunStartReviewedPreview: calls.preview,
}));
vi.mock("../clerk.js", () => ({
  verifyClerkSessionToken: calls.verify,
  getOrCreateLocalUser: calls.mirror,
}));
vi.mock("@vaettir/db", () => ({ prisma: { $transaction: calls.transaction } }));
vi.mock("../services/manualRunStart.js", () => ({
  startManualRun: calls.start,
}));
import { manualRunStartReviewedRouter } from "./manualRunStartReviewed.js";
import {
  manualRunStartReviewedReadKey as key,
  manualRunStartReviewedAccessOutput,
  manualRunStartReviewedPreviewOutput,
} from "../services/manualRunStartReviewedWireSchema.js";
const input = {
  projectId: "project",
  originalOrganizationId: "org",
  expectedClerkActorId: "verified-human",
  expectedNativeActorId: "native",
  requestId: "00000000-0000-4000-8000-000000000001",
};
const scope = {
  projectId: "project",
  organizationId: "org",
  actorId: "native",
  actorClerkUserId: "verified-human",
};
const db = { $transaction: calls.transaction };
function context(
  subject: unknown,
  signedIn = true,
  apiKey = false,
  omit = false,
) {
  return {
    prisma: db,
    user: signedIn
      ? {
          id: "native",
          clerkUserId: "cached-mapping-is-not-the-subject",
          name: "Synthetic",
          email: "fixture@example.invalid",
          ...(apiKey ? { apiKey: true } : {}),
          memberships: [
            { organizationId: "org", role: "OWNER", seatType: "FULL" },
          ],
        }
      : null,
    staff: null,
    ...(omit ? {} : { authenticatedClerkSubject: subject }),
  } as unknown as Context;
}
function outputs() {
  return {
    access: manualRunStartReviewedAccessOutput.parse({
      readContext: {
        scope,
        requestId: input.requestId,
        requestedKey: key(input, "ACCESS"),
        projection: "ACCESS",
      },
      canConfigure: true,
      canRecover: true,
    }),
    preview: manualRunStartReviewedPreviewOutput.parse({
      readContext: {
        scope,
        requestId: input.requestId,
        requestedKey: key(input, "PREVIEW"),
        projection: "PREVIEW",
      },
      canConfigure: true,
      canRecover: true,
      canStart: true,
      profile: {
        kind: "SUPPORTED",
        experience: null,
        profileHash: "a".repeat(64),
      },
      limitations: [],
    }),
  };
}
function untouched() {
  for (const call of Object.values(calls)) expect(call).not.toHaveBeenCalled();
}
beforeEach(() => {
  for (const call of Object.values(calls)) call.mockReset();
  const values = outputs();
  calls.access.mockResolvedValue(values.access);
  calls.preview.mockResolvedValue(values.preview);
  calls.start.mockImplementation(
    async (
      ctx: Context,
      request: {
        projectId: string;
        idempotencyKey: string;
        originalOrganizationId?: string;
        expectedClerkActorId?: string;
      },
    ) => ({
      testRunId: `manual_${createHash("sha256")
        .update(
          JSON.stringify([
            request.projectId,
            ctx.user!.id,
            request.idempotencyKey,
          ]),
        )
        .digest("hex")}`,
      ...(request.originalOrganizationId === undefined
        ? {}
        : {
            originalOrganizationId: request.originalOrganizationId,
            expectedClerkActorId: request.expectedClerkActorId,
            idempotencyKey: request.idempotencyKey,
          }),
    }),
  );
});

function writeEnvelope(endpoint: "start" | "recoverLegacy") {
  const request =
    endpoint === "start"
      ? {
          idempotencyKey: input.requestId,
          executionContext: { environment: " literal\n prose ", build: "" },
          expectedProfileHash: "a".repeat(64),
          originalOrganizationId: "org",
          expectedClerkActorId: "verified-human",
          testCaseIds: ["two", "one"],
          projectId: "project",
        }
      : {
          idempotencyKey: input.requestId,
          testCaseIds: ["two", "one"],
          projectId: "project",
        };
  return {
    request,
    mode:
      endpoint === "start" ? ("START" as const) : ("LEGACY_RECOVERY" as const),
    projectId: "project",
    originalOrganizationId: "org",
    expectedClerkActorId: "verified-human",
    expectedNativeActorId: "native",
  };
}
function writeCaller(
  subject: unknown = "verified-human",
  signedIn = true,
  apiKey = false,
  omitted = false,
) {
  return manualRunStartReviewedRouter.createCaller(
    context(subject, signedIn, apiKey, omitted),
  );
}
describe("actual reviewed run-start write transport (mocked writer, not JWT/native transaction proof)", () => {
  for (const endpoint of ["start", "recoverLegacy"] as const) {
    it.each([null, undefined, "", "x".repeat(201), "nul\0subject"])(
      `${endpoint} refuses independent subject %j BEFORE writer/transactions`,
      async (subject) => {
        const caller = manualRunStartReviewedRouter.createCaller(
          context(subject),
        );
        await expect(
          caller[endpoint](writeEnvelope(endpoint) as never),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        untouched();
      },
    );
    it(`${endpoint} omitted/API-key-without-human/signed-out subjects cannot acquire reviewed authority`, async () => {
      const body = writeEnvelope(endpoint);
      await expect(
        writeCaller(null, true, false, true)[endpoint](body as never),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        writeCaller(null, true, true)[endpoint](body as never),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        writeCaller("verified-human", false)[endpoint](body as never),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      untouched();
    });
    it(`${endpoint} forwards exact raw retained body and separately verified subject/native pins without cached-subject impersonation`, async () => {
      const raw = writeEnvelope(endpoint),
        before = JSON.stringify(raw),
        result = await writeCaller()[endpoint](raw as never);
      const [ctx, request, authorization] = calls.start.mock.calls[0]!;
      expect(JSON.stringify(request)).toBe(JSON.stringify(raw.request));
      expect(Object.keys(request)).toEqual(Object.keys(raw.request));
      expect(JSON.stringify(raw)).toBe(before);
      expect(request).not.toBe(raw.request);
      expect(Object.isFrozen(request)).toBe(true);
      expect(Object.isFrozen(request.testCaseIds)).toBe(true);
      expect(ctx.user.id).toBe("native");
      expect(ctx.user.clerkUserId).toBe("cached-mapping-is-not-the-subject");
      expect(Object.isFrozen(ctx.user)).toBe(true);
      expect(authorization).toEqual({
        mode: endpoint === "start" ? "REVIEWED_START" : "LEGACY_RECOVERY",
        projectId: "project",
        originalOrganizationId: "org",
        expectedClerkActorId: "verified-human",
        expectedNativeActorId: "native",
        authenticatedClerkSubject: "verified-human",
      });
      expect(result.currentScope).toEqual(scope);
      expect(result.historicalOuterProvenance).toBe("UNRECORDED");
      expect(result.interpretation).toBe("LEGACY_NORMALIZED_NOT_RAW_LOSSLESS");
      expect(result.idempotencyKey).toBe(input.requestId);
      expect(result).not.toHaveProperty("created");
      expect(result).not.toHaveProperty("rawSnapshotVerified");
      if (endpoint === "recoverLegacy") {
        for (const key of [
          "executionContext",
          "expectedProfileHash",
          "originalOrganizationId",
          "expectedClerkActorId",
        ])
          expect(request).not.toHaveProperty(key);
        expect(result.legacyAck).toEqual({
          testRunId: result.legacyAck.testRunId,
        });
      } else
        expect(request.executionContext).toEqual({
          environment: " literal\n prose ",
          build: "",
        });
      expect(calls.transaction).not.toHaveBeenCalled();
      expect(calls.access).not.toHaveBeenCalled();
      expect(calls.preview).not.toHaveBeenCalled();
      expect(calls.verify).not.toHaveBeenCalled();
      expect(calls.mirror).not.toHaveBeenCalled();
    });
    it.each(["native", "subject"])(
      `${endpoint} wrong original %s refuses before writer`,
      async (kind) => {
        const body = writeEnvelope(endpoint);
        if (kind === "native") body.expectedNativeActorId = "other";
        else {
          body.expectedClerkActorId = "other";
          if (endpoint === "start")
            Object.assign(body.request, { expectedClerkActorId: "other" });
        }
        await expect(
          writeCaller()[endpoint](body as never),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        untouched();
      },
    );
    it(`${endpoint} immutable body/context capture cannot be rebound during asynchronous writer work`, async () => {
      const raw = writeEnvelope(endpoint),
        originalContext = context("verified-human"),
        before = JSON.stringify(raw.request);
      const ordinary = calls.start.getMockImplementation()!;
      calls.start.mockImplementation(async (ctx, request, authorization) => {
        raw.request.testCaseIds.push("new");
        originalContext.user!.id = "changed-native";
        expect(JSON.stringify(request)).toBe(before);
        expect(ctx.user.id).toBe("native");
        expect(authorization.expectedNativeActorId).toBe("native");
        return ordinary(ctx, request, authorization);
      });
      const caller = manualRunStartReviewedRouter.createCaller(originalContext);
      const result = await caller[endpoint](raw as never);
      expect(result.currentScope.actorId).toBe("native");
      expect(result.legacyAck.testRunId).toMatch(/^manual_[a-f0-9]{64}$/);
    });
    it.each([
      "missing",
      "wrong-run",
      "scope",
      "uuid",
      "extra",
      "oversized",
      "getter",
    ])(
      `${endpoint} malformed %s ACK is UNKNOWN, never fabricated confirmation`,
      async (kind) => {
        const raw = writeEnvelope(endpoint),
          ordinary = calls.start.getMockImplementation()!;
        let getterCalls = 0;
        const valid = (await ordinary(
          context("verified-human"),
          raw.request,
        )) as Record<string, unknown>;
        const malformed = kind === "missing" ? {} : { ...valid };
        if (kind === "wrong-run")
          malformed.testRunId = "manual_" + "f".repeat(64);
        if (kind === "scope") malformed.originalOrganizationId = "foreign";
        if (kind === "uuid")
          malformed.idempotencyKey = "00000000-0000-4000-8000-000000000099";
        if (kind === "extra")
          malformed.privateBody = "PRIVATE synthetic stored body";
        if (kind === "oversized") malformed.testRunId = "PRIVATE".repeat(2000);
        if (kind === "getter")
          Object.defineProperty(malformed, "testRunId", {
            enumerable: true,
            get: () => {
              getterCalls++;
              return valid.testRunId;
            },
          });
        calls.start.mockResolvedValue(malformed);
        const promise = writeCaller()[endpoint](raw as never);
        await expect(promise).rejects.toMatchObject({
          code: "INTERNAL_SERVER_ERROR",
          message: expect.stringContaining("acceptance remains unknown"),
        });
        await expect(promise).rejects.not.toThrow(/PRIVATE/);
        expect(getterCalls).toBe(0);
        expect(JSON.stringify(raw)).toBe(
          JSON.stringify(writeEnvelope(endpoint)),
        );
      },
    );
    it(`${endpoint} preserves a writer failure/UNKNOWN cause without automatic retry/new key or preview`, async () => {
      const cause = Error("PRIVATE synthetic ambiguous writer response"),
        raw = writeEnvelope(endpoint),
        before = JSON.stringify(raw);
      calls.start.mockRejectedValue(cause);
      const response = writeCaller()[endpoint](raw as never);
      await expect(response).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
        message: expect.stringContaining("acceptance remains unknown"),
      });
      await expect(response).rejects.not.toThrow(/PRIVATE/);
      expect(calls.start).toHaveBeenCalledOnce();
      expect(JSON.stringify(raw)).toBe(before);
      expect(calls.preview).not.toHaveBeenCalled();
    });
    it.each([
      "BAD_REQUEST",
      "CONFLICT",
      "FORBIDDEN",
      "UNAUTHORIZED",
      "NOT_FOUND",
      "PRECONDITION_FAILED",
    ] as const)(
      `${endpoint} preserves typed business refusal %s without private cause or not-applied claim`,
      async (code) => {
        const raw = writeEnvelope(endpoint);
        calls.start.mockRejectedValue(
          new TRPCError({ code, message: "PRIVATE synthetic stored body" }),
        );
        const response = writeCaller()[endpoint](raw as never);
        await expect(response).rejects.toMatchObject({
          code,
          message: expect.stringContaining(
            "earlier unknown response remains unknown",
          ),
        });
        await expect(response).rejects.not.toThrow(
          /PRIVATE|nothing was started/,
        );
        expect(calls.start).toHaveBeenCalledOnce();
      },
    );
  }
  it.each([
    "expectedProfileHash",
    "executionContext",
    "idempotencyKey",
    "originalOrganizationId",
    "expectedClerkActorId",
  ])(
    "new START refuses naked legacy omission %s before writer",
    async (key) => {
      const body = writeEnvelope("start");
      Reflect.deleteProperty(body.request, key);
      await expect(writeCaller().start(body as never)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      untouched();
    },
  );
  it("recovery replay validates and forwards the same old UUID/body each time without current profile reads or creation flags", async () => {
    const raw = writeEnvelope("recoverLegacy"),
      before = JSON.stringify(raw);
    const first = await writeCaller().recoverLegacy(raw as never),
      second = await writeCaller().recoverLegacy(raw as never);
    expect(second).toEqual(first);
    expect(JSON.stringify(calls.start.mock.calls[0]![1])).toBe(
      JSON.stringify(calls.start.mock.calls[1]![1]),
    );
    expect(JSON.stringify(raw)).toBe(before);
    expect(calls.start.mock.calls[0]![2].mode).toBe("LEGACY_RECOVERY");
    expect(calls.preview).not.toHaveBeenCalled();
  });
});
describe("actual reviewed run-start read transport (mocked services, not JWT/native proof)", () => {
  for (const endpoint of ["access", "preview"] as const) {
    it.each([null, undefined, "", "x".repeat(201), "nul\0subject"])(
      `${endpoint} refuses subject %j before service/native transaction`,
      async (subject) => {
        const caller = manualRunStartReviewedRouter.createCaller(
          context(subject),
        );
        await expect(caller[endpoint](input)).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
        untouched();
      },
    );
    it(`${endpoint} refuses omitted subject and API-key native principal without independently human identity`, async () => {
      const omitted = manualRunStartReviewedRouter.createCaller(
        context(null, true, false, true),
      );
      const servicePrincipal = manualRunStartReviewedRouter.createCaller(
        context(null, true, true),
      );
      await expect(omitted[endpoint](input)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(servicePrincipal[endpoint](input)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      untouched();
    });
    it(`${endpoint} signed-out caller cannot use even a synthetic verified subject`, async () => {
      const caller = manualRunStartReviewedRouter.createCaller(
        context("verified-human", false),
      );
      await expect(caller[endpoint](input)).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      untouched();
    });
    it(`${endpoint} forwards exact independently verified subject, original native ID and complete input`, async () => {
      const caller = manualRunStartReviewedRouter.createCaller(
        context("verified-human"),
      );
      const value = await caller[endpoint](input);
      expect(value).toEqual(outputs()[endpoint]);
      expect(calls[endpoint]).toHaveBeenCalledWith(db, "native", input, {
        clerkActorId: "verified-human",
      });
      expect(calls.transaction).not.toHaveBeenCalled();
      expect(calls.verify).not.toHaveBeenCalled();
      expect(calls.mirror).not.toHaveBeenCalled();
    });
    it(`${endpoint} retains real protected/input/output validation`, async () => {
      const caller = manualRunStartReviewedRouter.createCaller(
        context("verified-human"),
      );
      await expect(
        caller[endpoint]({ ...input, canRecover: true } as typeof input),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      untouched();
      calls[endpoint].mockResolvedValue({});
      await expect(caller[endpoint](input)).rejects.toMatchObject({
        code: "INTERNAL_SERVER_ERROR",
      });
    });
  }
  it("only access may bootstrap without a native pin; no transport fallback invents it", async () => {
    const { expectedNativeActorId: _native, ...bootstrap } = input;
    calls.access.mockResolvedValue({
      ...outputs().access,
      readContext: {
        ...outputs().access.readContext,
        requestedKey: key(bootstrap, "ACCESS"),
      },
    });
    await manualRunStartReviewedRouter
      .createCaller(context("verified-human"))
      .access(bootstrap);
    expect(calls.access.mock.calls[0]![2]).toEqual(bootstrap);
    expect(calls.access.mock.calls[0]![2]).not.toHaveProperty(
      "expectedNativeActorId",
    );
    await expect(
      manualRunStartReviewedRouter
        .createCaller(context("verified-human"))
        .preview(bootstrap as typeof input),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(calls.preview).not.toHaveBeenCalled();
  });
});
