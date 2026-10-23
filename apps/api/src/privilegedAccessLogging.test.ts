import { describe, expect, it, vi } from "vitest";
import type { Context } from "./trpc.js";
import {
  liveAppScanProcedure,
  router,
  staffProcedure,
  staffTokenProcedure,
} from "./trpc.js";

const testRouter = router({
  staffEmail: staffProcedure.query(() => true),
  staffToken: staffTokenProcedure.query(() => true),
  liveAppScan: liveAppScanProcedure.query(() => true),
});

function user(email: string) {
  return {
    id: "user-id",
    clerkUserId: "clerk-id",
    email,
    name: null,
    avatarUrl: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    memberships: [],
  } as NonNullable<Context["user"]>;
}

describe("privileged access denial logging", () => {
  it("logs an allowlist denial without logging the user's email", async () => {
    const warn = vi.fn();
    const caller = testRouter.createCaller({
      prisma: {} as Context["prisma"],
      user: user("visitor@example.com"),
      staff: null,
      securityLogger: { warn },
      staffAttempt: {
        tokenConfigured: true,
        tokenPresented: false,
        actorHeaderPresented: false,
      },
    });

    await expect(caller.staffEmail()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).not.toContain(
      "visitor@example.com",
    );
  });

  it("logs whether a staff token and actor header were present, never their values", async () => {
    const warn = vi.fn();
    const caller = testRouter.createCaller({
      prisma: {} as Context["prisma"],
      user: null,
      staff: null,
      securityLogger: { warn },
      staffAttempt: {
        tokenConfigured: true,
        tokenPresented: true,
        actorHeaderPresented: true,
      },
    });

    await expect(caller.staffToken()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        securityEvent: expect.objectContaining({
          tokenPresented: true,
          actorHeaderPresented: true,
        }),
      }),
      "Privileged access denied",
    );
  });

  it("logs a live-app feature allowlist denial without logging identity data", async () => {
    const warn = vi.fn();
    const caller = testRouter.createCaller({
      prisma: {} as Context["prisma"],
      user: user("visitor@example.com"),
      staff: null,
      securityLogger: { warn },
      staffAttempt: {
        tokenConfigured: false,
        tokenPresented: false,
        actorHeaderPresented: false,
      },
    });

    await expect(caller.liveAppScan()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(warn).toHaveBeenCalledWith(
      {
        securityEvent: {
          type: "privileged_access_denied",
          surface: "live_app_scan",
          reason: "feature_not_allowlisted",
        },
      },
      "Privileged access denied",
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain(
      "visitor@example.com",
    );
  });

  it("does not emit denial events for authorized calls", async () => {
    const warn = vi.fn();
    const base = {
      prisma: {} as Context["prisma"],
      securityLogger: { warn },
      staffAttempt: {
        tokenConfigured: true,
        tokenPresented: true,
        actorHeaderPresented: true,
      },
    };

    await expect(
      testRouter
        .createCaller({
          ...base,
          user: user("james@skaldandstone.com"),
          staff: null,
        })
        .staffEmail(),
    ).resolves.toBe(true);
    await expect(
      testRouter
        .createCaller({ ...base, user: null, staff: { actor: "approved" } })
        .staffToken(),
    ).resolves.toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });
});
