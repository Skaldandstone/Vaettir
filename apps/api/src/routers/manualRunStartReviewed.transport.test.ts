import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../trpc.js";
const calls = vi.hoisted(() => ({
  access: vi.fn(),
  preview: vi.fn(),
  transaction: vi.fn(),
  verify: vi.fn(),
  mirror: vi.fn(),
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
