import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@vaettir/db";
import { describe, expect, it, vi } from "vitest";
import { releaseCreationIdentity, releaseCreationSchema, releaseCreationOutput } from "./releaseCreationSchema.js";
import { z } from "zod";

type Input = z.output<typeof releaseCreationSchema>;
type Ack = z.output<typeof releaseCreationOutput>;
type Status = "DRAFT" | "ACTIVE" | "IN_REVIEW" | "APPROVED" | "ARCHIVED";
type Plan = { id: string; projectId: string; releaseId: string | null; status: Status };
type Where = { id: { in: string[] }; projectId: string; releaseId: null; status?: { notIn: Status[] } };
type Receipt = { organizationId: string; projectId: string; actorId: string; entityId: string; metadata: { requestId: string; requestHash: string; releaseId: string } };
const source = readFileSync(new URL("../routers/releases.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("releases.ts", source, ts.ScriptTarget.Latest, true);
const routerStatement = ast.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(ast) === "releasesRouter"));
if (!routerStatement || !ts.isVariableStatement(routerStatement)) throw Error("Missing actual releases router");
const routerCall = routerStatement.declarationList.declarations[0]!.initializer;
if (!routerCall || !ts.isCallExpression(routerCall) || !routerCall.arguments[0] || !ts.isObjectLiteralExpression(routerCall.arguments[0])) throw Error("Missing actual releases router object");
const create = routerCall.arguments[0].properties.find(node => ts.isPropertyAssignment(node) && node.name.getText(ast) === "create");
if (!create || !ts.isPropertyAssignment(create) || !ts.isCallExpression(create.initializer) || !ts.isPropertyAccessExpression(create.initializer.expression) || create.initializer.expression.name.text !== "mutation") throw Error("Missing actual create mutation");
const callback = create.initializer.arguments[0];
if (!callback || !ts.isArrowFunction(callback)) throw Error("Missing actual create callback");
const code = ts.transpileModule("this.actual=(" + ts.createPrinter().printNode(ts.EmitHint.Unspecified, callback, ast) + ");", {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const actorId = "synthetic-actor", clerkId = "synthetic-clerk", organizationId = "synthetic-org", projectId = "synthetic-project";
const request = (patch: Partial<Input> = {}): Input => releaseCreationSchema.parse({ requestId: "10000000-0000-4000-8000-000000000001", originalOrganizationId: organizationId,
  expectedClerkActorId: clerkId, projectId, name: "Synthetic ordinary release", testPlanIds: ["synthetic-plan"], goals: ["Regular release"], ...patch });

function fixture(status: Status, options: { receipt?: Receipt; missingSavedRelease?: boolean; changedStatus?: Status } = {}) {
  // Actual router callback + actual schema/hash/TRPC errors/SQL tag, synthetic
  // transaction/admission/lock/database model only. Rollback below is modeled;
  // it is not PostgreSQL concurrency, authorization or persistence acceptance.
  const plan: Plan = { id: "synthetic-plan", projectId, releaseId: null, status };
  const releases: Array<{ id: string; name: string }> = [], audits: unknown[] = [], snapshots: unknown[] = [], trace: string[] = [];
  let modeledRollbacks = 0;
  const matches = (where: Where) => where.id.in.includes(plan.id) && where.projectId === plan.projectId && where.releaseId === plan.releaseId && !where.status?.notIn.includes(plan.status);
  const count = vi.fn(async ({ where }: { where: Where }) => { trace.push("count"); const value = matches(where) ? 1 : 0; if (options.changedStatus) plan.status = options.changedStatus; return value; });
  const updateMany = vi.fn(async ({ where, data }: { where: Where; data: { releaseId: string; updatedById: string } }) => {
    trace.push("updateMany"); if (!matches(where)) return { count: 0 }; plan.releaseId = data.releaseId; return { count: 1 };
  });
  const createRelease = vi.fn(async ({ data }: { data: { id: string; name: string } }) => { trace.push("createRelease"); const saved = { id: data.id, name: data.name }; releases.push(saved); return saved; });
  const findReceipt = vi.fn(async ({ where }: { where: { organizationId: string; projectId: string; actorId: string; entityType: string; entityId: string; metadata: { path: string[]; equals: string } } }) => {
    trace.push("receipt"); const receipt = options.receipt;
    return receipt && receipt.organizationId === where.organizationId && receipt.projectId === where.projectId && receipt.actorId === where.actorId && receipt.entityId === where.entityId && receipt.metadata.requestId === where.metadata.equals
      ? { metadata: receipt.metadata } : null;
  });
  const tx = {
    $executeRaw: vi.fn(async (_statement: Prisma.Sql) => 0), project: { findUniqueOrThrow: vi.fn(async () => ({ organizationId })) },
    auditLog: { findFirst: findReceipt, create: vi.fn(async (value: unknown) => { audits.push(value); return value; }) },
    testPlan: { count, updateMany },
    release: { create: createRelease, findFirst: vi.fn(async ({ where }: { where: { id: string; projectId: string } }) => {
      trace.push("savedRelease"); return !options.missingSavedRelease && options.receipt && where.id === options.receipt.metadata.releaseId && where.projectId === projectId
        ? { id: where.id, name: "Previously accepted release" } : null;
    }) },
  };
  const transaction = vi.fn(async (run: (value: typeof tx) => Promise<unknown>, _options: { timeout: number; maxWait: number }) => {
    const beforeReleaseId = plan.releaseId;
    try { return await run(tx); }
    catch (cause) { modeledRollbacks++; plan.releaseId = beforeReleaseId; releases.length = 0; audits.length = 0; throw cause; }
  });
  const admission = vi.fn(async (_ctx: unknown, admittedProjectId: string, role: string) => { trace.push("admission"); expect(admittedProjectId).toBe(projectId); expect(role).toBe("EDITOR"); });
  const projectLock = vi.fn(async (_tx: unknown, admittedActorId: string, admittedProjectId: string) => { trace.push("projectLock"); expect(admittedActorId).toBe(actorId); expect(admittedProjectId).toBe(projectId); });
  const actorLock = vi.fn(async (_tx: unknown, admittedActorId: string, scope: { clerkActorId: string }) => { trace.push("actorLock"); expect(admittedActorId).toBe(actorId); expect(scope).toEqual({ clerkActorId: clerkId }); });
  const context = vm.createContext({ Prisma, z, TRPCError, releaseCreationIdentity, requireProjectAccess: admission, lockCaseFieldProject: projectLock,
    lockCurrentCaseFieldActor: actorLock, snapshotTestPlanVersion: vi.fn(async (_tx: unknown, value: unknown) => snapshots.push(value)) });
  vm.runInContext(code, context);
  const actual = (context as unknown as { actual(value: { input: Input; ctx: { user: { id: string; clerkUserId: string }; prisma: { $transaction: typeof transaction } } }): Promise<Ack> }).actual;
  const run = (input = request()) => actual({ input, ctx: { user: { id: actorId, clerkUserId: clerkId }, prisma: { $transaction: transaction } } });
  return { run, plan, releases, audits, snapshots, trace, count, updateMany, createRelease, findReceipt, transaction, tx, admission, projectLock, actorLock,
    rollbacks: () => modeledRollbacks };
}
function historicalReceipt(input = request()): Receipt {
  const identity = releaseCreationIdentity(input, actorId);
  return { organizationId, projectId, actorId, entityId: identity.releaseId, metadata: { requestId: input.requestId, requestHash: identity.requestHash, releaseId: identity.releaseId } };
}

describe("actual release create plan lifecycle admission (synthetic callback/transaction only)", () => {
  it.each(["DRAFT", "ACTIVE", "IN_REVIEW"] as const)("preserves acceptance of unassigned %s plans and bounded locked request flow", async status => {
    const h = fixture(status), input = request(), bytes = JSON.stringify(input), result = await h.run(input);
    expect(releaseCreationOutput.parse(result)).toEqual({ id: releaseCreationIdentity(input, actorId).releaseId, name: input.name, requestId: input.requestId,
      projectId, originalOrganizationId: organizationId, expectedClerkActorId: clerkId });
    expect(h.plan.releaseId).toBe(releaseCreationIdentity(input, actorId).releaseId); expect(h.plan.status).toBe(status);
    expect(h.count.mock.calls[0]![0].where).toEqual({ id: { in: input.testPlanIds }, projectId, releaseId: null, status: { notIn: ["APPROVED", "ARCHIVED"] } });
    expect(h.updateMany.mock.calls[0]![0].where).toEqual(h.count.mock.calls[0]![0].where);
    expect(h.trace).toEqual(["admission", "projectLock", "actorLock", "receipt", "count", "createRelease", "updateMany"]);
    expect(h.transaction.mock.calls[0]![1]).toEqual({ timeout: 10000, maxWait: 5000 }); expect(h.tx.$executeRaw).toHaveBeenCalledOnce();
    expect(h.tx.$executeRaw.mock.calls[0]![0].strings.join("")).toBe("SET LOCAL statement_timeout = '8000ms'");
    expect(h.releases).toHaveLength(1); expect(h.audits).toHaveLength(1); expect(h.snapshots).toHaveLength(0); expect(JSON.stringify(input)).toBe(bytes); expect(h.rollbacks()).toBe(0);
  });
  it.each(["APPROVED", "ARCHIVED"] as const)("refuses a new %s assignment before any release creation or plan write", async status => {
    const h = fixture(status); await expect(h.run()).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("explicitly reopen") });
    expect(h.createRelease).not.toHaveBeenCalled(); expect(h.updateMany).not.toHaveBeenCalled(); expect(h.releases).toHaveLength(0); expect(h.audits).toHaveLength(0);
    expect(h.plan).toMatchObject({ status, releaseId: null }); expect(h.rollbacks()).toBe(1);
  });
  it.each(["APPROVED", "ARCHIVED"] as const)("a modeled transition to %s between count and conditional update refuses and models rollback", async changedStatus => {
    const h = fixture("DRAFT", { changedStatus }); await expect(h.run()).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("after review") });
    expect(h.count).toHaveBeenCalledOnce(); expect(h.createRelease).toHaveBeenCalledOnce(); expect(h.updateMany).toHaveBeenCalledOnce();
    expect(h.plan).toMatchObject({ status: changedStatus, releaseId: null }); expect(h.releases).toHaveLength(0); expect(h.audits).toHaveLength(0); expect(h.rollbacks()).toBe(1);
  });
  it.each(["APPROVED", "ARCHIVED"] as const)("exact historical receipt replay precedes newer %s admission and performs no new write", async status => {
    const input = request(), h = fixture(status, { receipt: historicalReceipt(input) }), result = await h.run(input);
    expect(releaseCreationOutput.parse(result)).toEqual({ id: historicalReceipt(input).metadata.releaseId, name: "Previously accepted release", requestId: input.requestId,
      projectId, originalOrganizationId: organizationId, expectedClerkActorId: clerkId });
    expect(h.trace).toEqual(["admission", "projectLock", "actorLock", "receipt", "savedRelease"]);
    expect(h.count).not.toHaveBeenCalled(); expect(h.updateMany).not.toHaveBeenCalled(); expect(h.createRelease).not.toHaveBeenCalled(); expect(h.audits).toHaveLength(0); expect(h.plan.releaseId).toBeNull();
  });
  it("a changed original receipt body cannot reuse its UUID/hash or write a replacement", async () => {
    const input = request(), h = fixture("ARCHIVED", { receipt: historicalReceipt(input) });
    await expect(h.run(request({ name: "Changed body" }))).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("different content") });
    expect(h.count).not.toHaveBeenCalled(); expect(h.createRelease).not.toHaveBeenCalled(); expect(h.updateMany).not.toHaveBeenCalled();
  });
  it.each([{ originalOrganizationId: "different-org" }, { expectedClerkActorId: "different-clerk" }])("changed original scope %s is refused before receipt lookup", async patch => {
    const h = fixture("ARCHIVED", { receipt: historicalReceipt() }); await expect(h.run(request(patch))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.findReceipt).not.toHaveBeenCalled(); expect(h.count).not.toHaveBeenCalled(); expect(h.createRelease).not.toHaveBeenCalled(); expect(h.updateMany).not.toHaveBeenCalled();
  });
  it("a foreign-actor receipt is not a replay and cannot evade the archived-plan admission", async () => {
    const receipt = historicalReceipt(), h = fixture("ARCHIVED", { receipt: { ...receipt, actorId: "foreign-actor" } });
    await expect(h.run()).rejects.toMatchObject({ code: "CONFLICT" });
    expect(h.findReceipt.mock.calls[0]![0].where).toMatchObject({ organizationId, projectId, actorId, entityId: receipt.entityId });
    expect(h.createRelease).not.toHaveBeenCalled(); expect(h.updateMany).not.toHaveBeenCalled();
  });
  it("a receipt with unavailable saved release still refuses instead of manufacturing a replacement", async () => {
    const h = fixture("ARCHIVED", { receipt: historicalReceipt(), missingSavedRelease: true }); await expect(h.run()).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(h.count).not.toHaveBeenCalled(); expect(h.createRelease).not.toHaveBeenCalled(); expect(h.updateMany).not.toHaveBeenCalled();
  });
});
