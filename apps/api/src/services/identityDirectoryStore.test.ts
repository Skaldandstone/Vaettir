import { describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "@vaettir/db";
import { createIdentityDirectoryStore, DirectoryObservationConflict, DirectoryObservationUnavailable } from "./identityDirectoryStore.js";

// Transaction double checks the service protocol, NOT PostgreSQL concurrency,
// rollback or FK enforcement. Real database acceptance remains a release gate.
function fixture() {
  let now = 1000000;
  const subject = {
    id: "subject", organizationId: "org", connectionId: "connection", userId: "user",
    clerkSubject: "clerk-user", externalSubjectId: "external-user", enabled: true, revision: 1,
    requestedGeneration: 0, appliedGeneration: 0, observedConnectionRevision: null as number | null,
    observedSubjectRevision: null as number | null, reservedAt: null as Date | null, reservedUntil: null as Date | null,
    active: false, externalGroupIds: [] as string[], observedAt: null as Date | null, expiresAt: null as Date | null,
    connection: { organizationId: "org", enabled: true, revision: 1, observationLeaseSeconds: 300,
      providerInstanceId: "instance", providerConnectionId: "enterprise", providerDirectoryId: "directory",
      organization: { suspendedAt: null as Date | null } },
    membership: { organizationId: "org", userId: "user", user: { clerkUserId: "clerk-user" } },
  };
  const db = {
    identityDirectorySubject: { findUnique: vi.fn().mockImplementation(async ({ where }) =>
      where.organizationId_id.organizationId === subject.organizationId && where.organizationId_id.id === subject.id ? subject : null),
    updateMany: vi.fn().mockImplementation(async ({ data }) => { Object.assign(subject, data); return { count: 1 }; }) },
    identityDirectoryReceipt: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation(async work => work(db));
  const store = createIdentityDirectoryStore(db as unknown as PrismaClient, () => now);
  const target = { organizationId: "org", subjectId: "subject" };
  const observation = { providerInstanceId: "instance", providerConnectionId: "enterprise", providerDirectoryId: "directory",
    externalSubjectId: "external-user", clerkSubject: "clerk-user", complete: true as const, active: true, externalGroupIds: ["group-b", "group-a"] };
  return { db, subject, store, target, observation, advance: (delta: number) => { now += delta; } };
}

describe("directory source journal (synthetic transaction double)", () => {
  it("reserves before observation and commits an attributed receipt with server-controlled expiry", async () => {
    const f = fixture(); const ticket = await f.store.reserve(f.target);
    f.advance(1000);
    expect(await f.store.commit(ticket, f.observation)).toMatchObject({ generation: 1, active: true, groupCount: 2 });
    expect(f.subject.externalGroupIds).toEqual(["group-a", "group-b"]);
    expect(f.subject.expiresAt?.getTime()).toBe(1300000); // Not extended by completion time.
    expect(f.db.identityDirectoryReceipt.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      organizationId: "org", subjectId: "subject", generation: 1, connectionRevision: 1,
      providerInstanceId: "instance", providerDirectoryId: "directory", clerkSubject: "clerk-user", userId: "user",
      externalGroupIds: ["group-a", "group-b"],
    }) });
    expect(f.db.$transaction).toHaveBeenLastCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(await f.store.readCurrent(f.target)).toMatchObject({ active: true, externalGroupIds: ["group-a", "group-b"] });
  });
  it("new reservations supersede old fetches, including when the newer fetch has not completed", async () => {
    const f = fixture(); const old = await f.store.reserve(f.target); const latest = await f.store.reserve(f.target);
    await expect(f.store.commit(old, f.observation)).rejects.toBeInstanceOf(DirectoryObservationConflict);
    await f.store.commit(latest, { ...f.observation, active: false });
    expect(f.subject.externalGroupIds).toEqual([]);
    await expect(f.store.commit(old, f.observation)).rejects.toBeInstanceOf(DirectoryObservationConflict);
    await expect(f.store.commit(latest, f.observation)).rejects.toBeInstanceOf(DirectoryObservationConflict);
    expect((await f.store.readCurrent(f.target))?.active).toBe(false);
  });
  it("a new valid observation may reactivate the same immutable binding", async () => {
    const f = fixture(); await f.store.commit(await f.store.reserve(f.target), { ...f.observation, active: false });
    await f.store.commit(await f.store.reserve(f.target), f.observation);
    expect((await f.store.readCurrent(f.target))?.active).toBe(true);
  });
  it.each(["providerInstanceId", "providerConnectionId", "providerDirectoryId", "externalSubjectId", "clerkSubject"] as const)("rejects mismatched %s", async key => {
    const f = fixture(); const ticket = await f.store.reserve(f.target);
    await expect(f.store.commit(ticket, { ...f.observation, [key]: "different" })).rejects.toBeInstanceOf(DirectoryObservationUnavailable);
    expect(f.db.identityDirectoryReceipt.create).not.toHaveBeenCalled();
  });
  it.each(["connection", "subject"] as const)("rejects changed %s revisions and invalidates earlier evidence", async kind => {
    const f = fixture(); await f.store.commit(await f.store.reserve(f.target), f.observation);
    const ticket = await f.store.reserve(f.target);
    if (kind === "connection") f.subject.connection.revision++; else f.subject.revision++;
    expect(await f.store.readCurrent(f.target)).toBeNull();
    await expect(f.store.commit(ticket, f.observation)).rejects.toBeInstanceOf(DirectoryObservationConflict);
  });
  it.each(["connection", "subject", "suspension", "native-subject", "membership"])("rechecks %s at commit", async kind => {
    const f = fixture(); const ticket = await f.store.reserve(f.target);
    if (kind === "connection") f.subject.connection.enabled = false;
    if (kind === "subject") f.subject.enabled = false;
    if (kind === "suspension") f.subject.connection.organization.suspendedAt = new Date();
    if (kind === "native-subject") f.subject.membership.user.clerkUserId = "rebound";
    if (kind === "membership") f.subject.membership.organizationId = "other";
    await expect(f.store.commit(ticket, f.observation)).rejects.toBeInstanceOf(DirectoryObservationUnavailable);
    await expect(f.store.readCurrent(f.target)).rejects.toBeInstanceOf(DirectoryObservationUnavailable);
    expect(f.db.identityDirectoryReceipt.create).not.toHaveBeenCalled();
  });
  it("does not find a subject through another tenant", async () => {
    const f = fixture(); await expect(f.store.reserve({ ...f.target, organizationId: "other" })).rejects.toBeInstanceOf(DirectoryObservationUnavailable);
    expect(f.db.identityDirectorySubject.updateMany).not.toHaveBeenCalled();
  });
  it("rejects incomplete observations and unloaded/duplicate groups", async () => {
    const f = fixture(); const ticket = await f.store.reserve(f.target);
    for (const bad of [{ ...f.observation, complete: false }, { ...f.observation, externalGroupIds: undefined },
      { ...f.observation, externalGroupIds: ["same", "same"] }]) {
      await expect(f.store.commit(ticket, bad as never)).rejects.toThrow();
    }
    expect(f.db.identityDirectoryReceipt.create).not.toHaveBeenCalled();
    expect(f.subject.appliedGeneration).toBe(0);
  });
  it("never extends an expired lease while a fresh fetch is pending or fails", async () => {
    const f = fixture(); await f.store.commit(await f.store.reserve(f.target), f.observation);
    f.advance(299000); const next = await f.store.reserve(f.target); f.advance(1000);
    expect(await f.store.readCurrent(f.target)).toBeNull();
    f.advance(299000);
    await expect(f.store.commit(next, f.observation)).rejects.toBeInstanceOf(DirectoryObservationConflict);
  });
  it("rejects backwards clock movement", async () => {
    const f = fixture(); const ticket = await f.store.reserve(f.target); f.advance(-1);
    await expect(f.store.commit(ticket, f.observation)).rejects.toBeInstanceOf(DirectoryObservationConflict);
  });
  it("rejects a lost compare-and-swap at reserve or commit", async () => {
    const f = fixture(); f.db.identityDirectorySubject.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(f.store.reserve(f.target)).rejects.toBeInstanceOf(DirectoryObservationConflict);
    const ticket = await f.store.reserve(f.target); f.db.identityDirectorySubject.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(f.store.commit(ticket, f.observation)).rejects.toBeInstanceOf(DirectoryObservationConflict);
    expect(f.db.identityDirectoryReceipt.create).not.toHaveBeenCalled();
  });
  it("propagates receipt failures out of the transaction instead of acknowledging a save", async () => {
    const f = fixture(); const ticket = await f.store.reserve(f.target);
    f.db.identityDirectoryReceipt.create.mockRejectedValueOnce(new Error("receipt unavailable"));
    await expect(f.store.commit(ticket, f.observation)).rejects.toThrow("receipt unavailable");
    // Rollback is deliberately not claimed from this double.
  });
  it.each(["P2002", "P2034"])("does not silently replay a %s conflict", async code => {
    const f = fixture(); f.db.$transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("conflict", { code, clientVersion: "test" }));
    await expect(f.store.reserve(f.target)).rejects.toBeInstanceOf(DirectoryObservationConflict);
    expect(f.db.$transaction).toHaveBeenCalledTimes(1);
  });
  it("rejects generation exhaustion instead of wrapping", async () => {
    const f = fixture(); f.subject.requestedGeneration = 2147483647;
    await expect(f.store.reserve(f.target)).rejects.toBeInstanceOf(DirectoryObservationConflict);
  });
  it.each([0, 3601, 1.5, Number.NaN])("rejects invalid configured leases (%s)", async lease => {
    const f = fixture(); f.subject.connection.observationLeaseSeconds = lease;
    await expect(f.store.reserve(f.target)).rejects.toBeInstanceOf(DirectoryObservationUnavailable);
  });
  it("rejects a missing native membership instead of recreating it", async () => {
    const f = fixture(); f.db.identityDirectorySubject.findUnique.mockResolvedValueOnce(null);
    await expect(f.store.reserve(f.target)).rejects.toBeInstanceOf(DirectoryObservationUnavailable);
    expect(f.db.identityDirectorySubject.updateMany).not.toHaveBeenCalled();
  });
});
