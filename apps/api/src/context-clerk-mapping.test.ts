import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(), mirror: vi.fn(), reread: vi.fn(), apiKey: vi.fn(),
  serviceUser: vi.fn(), touchKey: vi.fn(),
}));
vi.mock("./clerk.js", () => ({
  verifyClerkSessionToken: mocks.verify,
  getOrCreateLocalUser: mocks.mirror,
}));
vi.mock("@vaettir/db", () => ({
  prisma: {
    user: { findUniqueOrThrow: mocks.reread, findUnique: mocks.serviceUser },
    apiKey: { findUnique: mocks.apiKey, update: mocks.touchKey },
  },
}));
import { createContext } from "./trpc.js";

const user = { id: "native-synthetic", clerkUserId: "clerk-original", memberships: [] };
function request(token = "synthetic-session") {
  return { req: { headers: { authorization: `Bearer ${token}` }, log: {} } } as unknown as CreateFastifyContextOptions;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.verify.mockResolvedValue("clerk-original");
  mocks.mirror.mockResolvedValue({ id: user.id });
  mocks.reread.mockResolvedValue(user);
});
describe("verified Clerk identity survives native membership reread", () => {
  it("admits the exact verified subject and current native user together", async () => {
    const context = await createContext(request());
    expect(context.user).toEqual(user);
    expect(context.authenticatedClerkSubject).toBe("clerk-original");
    expect(mocks.mirror).toHaveBeenCalledWith("clerk-original");
    expect(mocks.reread).toHaveBeenCalledWith({ where: { id: user.id }, include: { memberships: true } });
  });
  it("refuses a native mapping changed between mirror resolution and the context reread", async () => {
    mocks.reread.mockResolvedValue({ ...user, clerkUserId: "clerk-replacement" });
    const context = await createContext(request());
    expect(context.user).toBeNull();
    expect(context.authenticatedClerkSubject).toBeNull();
    expect(mocks.verify).toHaveBeenCalledWith("synthetic-session");
  });
  it("does not resolve or admit a user after failed token verification", async () => {
    mocks.verify.mockResolvedValue(null);
    const context = await createContext(request());
    expect(context.user).toBeNull();
    expect(context.authenticatedClerkSubject).toBeNull();
    expect(mocks.mirror).not.toHaveBeenCalled();
    expect(mocks.reread).not.toHaveBeenCalled();
  });
  it("does not mask a missing native mirror as an authenticated user", async () => {
    mocks.reread.mockRejectedValue(new Error("Synthetic mirror missing"));
    await expect(createContext(request())).rejects.toThrow("Synthetic mirror missing");
  });
  it("preserves the distinct API-key service-principal resolution path", async () => {
    const service = { ...user, id: "native-service", clerkUserId: "service-synthetic" };
    mocks.apiKey.mockResolvedValue({ id: "key-synthetic", serviceUserId: service.id, revokedAt: null });
    mocks.touchKey.mockResolvedValue({});
    mocks.serviceUser.mockResolvedValue(service);
    const context = await createContext(request("vt_synthetic-only"));
    expect(context.user).toEqual(service);
    expect(context.authenticatedClerkSubject).toBeNull();
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.mirror).not.toHaveBeenCalled();
    expect(mocks.serviceUser).toHaveBeenCalledWith({ where: { id: service.id }, include: { memberships: true } });
  });
  it("does not invent human-session proof from an anonymous context or supplied subject header", async () => {
    const options = { req: { headers: { "x-clerk-subject": "clerk-original" }, log: {} } } as unknown as CreateFastifyContextOptions;
    const context = await createContext(options);
    expect(context.user).toBeNull();
    expect(context.authenticatedClerkSubject).toBeNull();
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.reread).not.toHaveBeenCalled();
  });
  it("ignores an untrusted subject header while preserving the independently verified JWT subject", async () => {
    const options = request();
    options.req.headers["x-clerk-subject"] = "clerk-replacement";
    const context = await createContext(options);
    expect(context.user).toEqual(user);
    expect(context.authenticatedClerkSubject).toBe("clerk-original");
  });
});
