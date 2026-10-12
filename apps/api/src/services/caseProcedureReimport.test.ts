// Actual review/approval service with modeled database and authorization
// boundaries. No native transaction, alias migration or PostgreSQL proof.
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "@vaettir/db";
import { caseProcedureExportSchema, type CaseProcedureExport } from "@vaettir/core";
import { qualityProfileHash } from "./qualityExperienceProfile.js";

const boundary = vi.hoisted(() => ({
  capture: vi.fn(), plan: vi.fn(), projectLock: vi.fn(), actorLock: vi.fn(), metadata: vi.fn(), snapshot: vi.fn(),
}));
vi.mock("./caseProcedureExport.js", () => ({ captureCaseProcedureExport: boundary.capture }));
vi.mock("./testPlanExecution.js", () => ({ requireCurrentPlanAccess: boundary.plan }));
vi.mock("./caseFields.js", () => ({ lockCaseFieldProject: boundary.projectLock, readCaseFieldState: boundary.metadata }));
vi.mock("./caseFieldReadScope.js", () => ({ lockCurrentCaseFieldActor: boundary.actorLock }));
vi.mock("./testCaseVersion.js", () => ({ snapshotTestCaseVersion: boundary.snapshot }));
import { approveProcedureReimport, previewProcedureReimport } from "./caseProcedureReimport.js";

type Procedure = CaseProcedureExport["cases"][number];
function procedure(): Procedure {
  return { id: "case-1", displayId: "new-01", caseNumber: 1, title: " Current\nmanual λ ", background: " Exact\nbackground ",
    given: ["", " Raw Given\n | λ "], when: [], then: [], tags: ["", " tag|literal ", "duplicate", "duplicate"],
    authoredSteps: [{ order: 0, action: " Click\nbutton ", expectedActionOrData: null, expectedResult: "", expectedResponse: " Response\n{ literal | λ } ", mediaAttachmentIds: ["media-1"] }],
    resolvedSteps: [{ order: 0, action: " Click\nbutton ", expectedActionOrData: null, expectedResult: "", expectedResponse: " Response\n{ literal | λ } ", mediaAttachmentIds: ["media-1"] }],
    sharedStepGroup: null, validationDomain: "SOFTWARE", verificationProfile: { setup: "", safety: "", instruments: "", acceptanceCriteria: "" }, suitePath: "Preserve/suite", testType: "FUNCTIONAL", automationStatus: "MANUAL", priority: "HIGH", origin: "IMPORTED", reviewStatus: "APPROVED", archived: false,
    prerequisites: [{ id: "case-2", displayId: "new-02", title: " Prerequisite\nexact ", archived: false }],
    mediaReferences: [{ id: "media-1", fileName: "owned.png", contentType: "image/png", sizeBytes: 4, uploadMetadataVerified: true }],
  };
}
function bundle(key = "old"): CaseProcedureExport {
  const p = procedure(); p.displayId = `${key}-01`; p.prerequisites[0]!.displayId = `${key}-02`;
  return caseProcedureExportSchema.parse({ format: "vaettir.case-procedure", version: 1, capturedAt: "2026-10-12T00:00:00.000Z", project: { id: "project-1", name: "Owned synthetic", caseKey: key }, scope: { kind: "selected", includeArchived: false }, importSupported: false,
    excluded: ["attachment-bytes", "datasets", "case-and-run-history", "paid-drafts", "document-bytes"], cases: [p] });
}
function fixture() {
  const project = { organizationId: "org-1", caseKey: "new", caseFieldSchema: { version: 1, fields: [] }, caseFieldSchemaVersion: 0 };
  let aliases = ["old", "new"].map(caseKey => ({ projectId: "project-1", organizationId: "org-1", caseKey }));
  const rows = new Map([
    ["case-1", { id: "case-1", displayId: "old-01", caseNumber: 1, archived: false, updatedAt: new Date("2026-10-12T00:00:00.000Z"), testPlanId: null, sortPosition: 12 }],
    ["case-2", { id: "case-2", displayId: "old-02", caseNumber: 2, archived: false, updatedAt: new Date("2026-10-12T00:00:00.000Z"), testPlanId: null, sortPosition: 13 }],
  ]);
  const queries: Array<{ sql: string; values: unknown[] }> = [];
  const query = {
    project: { findUniqueOrThrow: vi.fn(async () => project) },
    testCase: { findFirst: vi.fn(async ({ where }: { where: { id: string; projectId: string; archived?: boolean } }) => {
      const row = rows.get(where.id);
      return where.projectId === "project-1" && row && !(where.archived === false && row.archived) ? row : null;
    }), update: vi.fn(async () => ({})) },
    testCaseStep: { deleteMany: vi.fn(async () => ({})), createMany: vi.fn(async () => ({})) },
    testCaseAttachment: { findFirst: vi.fn(async () => ({ id: "media-1" }) as { id: string } | null) },
    auditLog: { findFirst: vi.fn(async () => null as { organizationId: string; metadata: Prisma.JsonValue } | null), create: vi.fn(async () => ({})) },
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?"); queries.push({ sql, values });
      if (sql.includes('FROM "ProjectCaseKeyAlias"')) {
        const requested = (values[2] as Prisma.Sql).values;
        return aliases.filter(alias => requested.includes(alias.caseKey));
      }
      if (sql.includes("octet_length")) return [{ bytes: 1024n }];
      return [];
    }),
  };
  const db = { $transaction: vi.fn(async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => fn(query as unknown as Prisma.TransactionClient)) } as unknown as PrismaClient;
  const live = bundle("new"); boundary.capture.mockImplementation(async () => structuredClone(live));
  return { db, query, queries, project, rows, live, aliases: (value: typeof aliases) => { aliases = value; } };
}
const authorized = { clerkActorId: "Clerk-1" }, expectedScope = { organizationId: "org-1", clerkActorId: "Clerk-1" };
beforeEach(() => {
  vi.clearAllMocks(); boundary.plan.mockResolvedValue(undefined); boundary.projectLock.mockResolvedValue(undefined);
  boundary.actorLock.mockResolvedValue("Clerk-1"); boundary.metadata.mockResolvedValue({ problems: [] }); boundary.snapshot.mockResolvedValue(undefined);
});
async function approval(f: ReturnType<typeof fixture>, incoming: CaseProcedureExport) {
  const input = { projectId: "project-1", serialized: JSON.stringify(incoming), expectedScope };
  const preview = await previewProcedureReimport(f.db, "native-1", input, authorized);
  return { ...input, expectedReviewHash: preview.expectedReviewHash, actorId: "native-1", selections: [{ caseId: "case-1", reason: " Deliberate restore ", overwriteConfirmed: true as const }], confirmed: true as const, requestId: randomUUID() };
}
describe("procedure reimport current/historical alias compatibility", () => {
  it.each(["old", "new"])("%s export labels resolve the exact existing immutable case and prerequisite without a nested lookup", async key => {
    const f = fixture(), incoming = bundle(key), original = JSON.stringify(incoming);
    const preview = await previewProcedureReimport(f.db, "native-1", { projectId: "project-1", serialized: original, expectedScope }, authorized);
    expect(preview.entries[0]!.status).toBe("UNCHANGED"); expect(preview.entries[0]!.missingRelationships).toEqual([]);
    expect(JSON.stringify(incoming)).toBe(original); expect(f.query.testCase.update).not.toHaveBeenCalled();
    expect(f.query.testCase.findFirst.mock.calls.map(([input]) => input.where)).toEqual([{ id: "case-1", projectId: "project-1" }, { id: "case-2", projectId: "project-1", archived: false }]);
    const lookup = f.queries.find(item => item.sql.includes('FROM "ProjectCaseKeyAlias"'))!;
    expect(lookup.sql).toContain('"projectId"=? AND "organizationId"=?');
    expect(lookup.values[0]).toBe("project-1"); expect(lookup.values[1]).toBe("org-1");
    expect((lookup.values[2] as Prisma.Sql).values).toEqual([key]); expect(lookup.values[3]).toBe(2);
    expect(boundary.projectLock).toHaveBeenCalledWith(expect.anything(), "native-1", "project-1");
    expect(boundary.actorLock).toHaveBeenCalledWith(expect.anything(), "native-1", authorized);
    expect(boundary.metadata).toHaveBeenCalledWith(expect.anything(), "native-1", "project-1", "case-1", "Clerk-1");
  });
  it.each(["old", "new"])("%s reviewed restore writes exact raw authored content/media only, with original UUID/hash receipt", async key => {
    const f = fixture(), incoming = bundle(key); incoming.cases[0]!.title = " Restored\nλ | <literal> ";
    incoming.cases[0]!.authoredSteps[0]!.action = " Changed\nexact action "; incoming.cases[0]!.resolvedSteps = incoming.cases[0]!.authoredSteps;
    const input = await approval(f, incoming), result = await approveProcedureReimport(f.db, "native-1", input, authorized);
    expect(result.restored).toEqual([{ caseId: "case-1", displayId: "new-01" }]);
    expect(f.query.testCase.update).toHaveBeenCalledWith({ where: { id: "case-1" }, data: {
      title: incoming.cases[0]!.title, background: incoming.cases[0]!.background, given: incoming.cases[0]!.given, when: [], then: [], tags: incoming.cases[0]!.tags,
      testType: "FUNCTIONAL", validationDomain: "SOFTWARE", verificationProfile: incoming.cases[0]!.verificationProfile, updatedById: "native-1",
    } });
    expect(f.query.testCaseStep.createMany).toHaveBeenCalledWith({ data: incoming.cases[0]!.authoredSteps.map(step => ({ ...step, testCaseId: "case-1" })) });
    expect(boundary.snapshot).toHaveBeenCalledTimes(2); expect(f.query.testCaseAttachment.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "media-1", testCaseId: "case-1", testCase: { projectId: "project-1" }, uploadCompletedAt: { not: null }, fileName: "owned.png", contentType: "image/png", sizeBytes: 4 } }));
    expect(f.query.auditLog.create).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: "org-1", projectId: "project-1", actorId: "native-1", metadata: expect.objectContaining({ requestId: input.requestId, requestHash: qualityProfileHash(input), bundleHash: qualityProfileHash(incoming) }) }) }));
    expect(f.rows.get("case-1")!.displayId).toBe("old-01");
  });
  it.each(["case-prefix", "case-number", "case-id", "prerequisite-prefix", "prerequisite-number", "prerequisite-id", "prerequisite-archived", "noncanonical", "archived"])("%s never becomes an accepted alias or replacement case", async fault => {
    const f = fixture(), incoming = bundle("old"), p = incoming.cases[0]!;
    if (fault === "case-prefix") p.displayId = "foreign-01";
    if (fault === "case-number") p.displayId = "old-02";
    if (fault === "case-id") p.id = "missing-identity";
    if (fault === "prerequisite-prefix") p.prerequisites[0]!.displayId = "foreign-02";
    if (fault === "prerequisite-number") p.prerequisites[0]!.displayId = "old-01";
    if (fault === "prerequisite-id") p.prerequisites[0]!.id = "missing-prerequisite";
    if (fault === "prerequisite-archived") f.rows.get("case-2")!.archived = true;
    if (fault === "noncanonical") p.displayId = " OLD-01 ";
    if (fault === "archived") f.rows.get("case-1")!.archived = true;
    p.title = "Forbidden incoming";
    const input = await approval(f, incoming);
    const preview = await previewProcedureReimport(f.db, "native-1", input, authorized);
    expect(preview.entries[0]!.status).toBe(fault === "case-id" ? "NEW_UNAVAILABLE" : "UNAVAILABLE");
    await expect(approveProcedureReimport(f.db, "native-1", input, authorized)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(f.query.testCase.update).not.toHaveBeenCalled(); expect(f.query.testCaseStep.deleteMany).not.toHaveBeenCalled(); expect(boundary.snapshot).not.toHaveBeenCalled();
  });
  it.each(["metadata", "shared-library", "media", "resolved-procedure"])("a valid historical alias cannot bypass %s content/reference refusal", async fault => {
    const f = fixture(), incoming = bundle("old"); incoming.cases[0]!.title = "Incoming";
    if (fault === "metadata") boundary.metadata.mockResolvedValue({ problems: ["Required metadata is absent"] });
    if (fault === "shared-library") incoming.cases[0]!.sharedStepGroup = { id: "other-library", name: "Not attached" };
    if (fault === "media") f.query.testCaseAttachment.findFirst.mockResolvedValue(null);
    if (fault === "resolved-procedure") incoming.cases[0]!.resolvedSteps[0]!.action = "Different resolved content";
    const input = await approval(f, incoming);
    const preview = await previewProcedureReimport(f.db, "native-1", input, authorized);
    expect(preview.entries[0]!.status).toBe("UNAVAILABLE"); expect(preview.entries[0]!.missingRelationships.length).toBeGreaterThan(0);
    await expect(approveProcedureReimport(f.db, "native-1", input, authorized)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(f.query.testCase.update).not.toHaveBeenCalled(); expect(boundary.snapshot).not.toHaveBeenCalled();
  });
  it.each(["foreign-project", "foreign-org", "unexpected-prefix", "duplicate", "unregistered-header"])("%s alias registry proof is refused before current private content is captured", async fault => {
    const f = fixture(), incoming = bundle("old"), row = { projectId: "project-1", organizationId: "org-1", caseKey: "old" };
    if (fault === "foreign-project") f.aliases([{ ...row, projectId: "other-project" }]);
    if (fault === "foreign-org") f.aliases([{ ...row, organizationId: "other-org" }]);
    if (fault === "duplicate") f.aliases([row, row]);
    if (fault === "unregistered-header") incoming.project.caseKey = "unknown";
    if (fault === "unexpected-prefix") f.query.$queryRaw.mockImplementation(async () => [{ ...row, caseKey: "unexpected" }]);
    await expect(previewProcedureReimport(f.db, "native-1", { projectId: "project-1", serialized: JSON.stringify(incoming), expectedScope }, authorized)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(boundary.capture).not.toHaveBeenCalled(); expect(f.query.testCase.update).not.toHaveBeenCalled();
  });
  it("old accepted receipts replay exact saved labels/body without alias reads or historical evidence rewrites", async () => {
    const f = fixture(), incoming = bundle("old"); incoming.cases[0]!.title = "Incoming";
    const input = await approval(f, incoming), saved = { requestId: input.requestId, restored: [{ caseId: "case-1", displayId: "old-01" }], replayed: false, freshnessNotice: "Historical notice" };
    f.query.auditLog.findFirst.mockResolvedValue({ organizationId: "org-1", metadata: { requestHash: qualityProfileHash(input), result: saved } });
    f.queries.length = 0; boundary.capture.mockClear();
    expect(await approveProcedureReimport(f.db, "native-1", input, authorized)).toEqual({ ...saved, replayed: true, projectId: "project-1", organizationId: "org-1", actorClerkUserId: "Clerk-1" });
    expect(f.queries).toEqual([]); expect(boundary.capture).not.toHaveBeenCalled(); expect(f.query.auditLog.create).not.toHaveBeenCalled(); expect(f.query.testCase.update).not.toHaveBeenCalled();
  });
  it("original scope and actor refusals precede alias resolution even when labels would be valid", async () => {
    const f = fixture(), input = { projectId: "project-1", serialized: JSON.stringify(bundle("old")), expectedScope };
    f.project.organizationId = "other-org";
    await expect(previewProcedureReimport(f.db, "native-1", input, authorized)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(f.queries).toEqual([]);
    f.project.organizationId = "org-1"; boundary.actorLock.mockRejectedValue(Error("Synthetic current actor refusal"));
    await expect(previewProcedureReimport(f.db, "native-1", input, authorized)).rejects.toThrow("Synthetic current actor refusal"); expect(f.queries).toEqual([]);
  });
  it("a legacy accepted receipt cannot migrate to the new organization even when current access and copied aliases are valid", async () => {
    const f = fixture(), incoming = bundle("old"); incoming.cases[0]!.title = "Incoming";
    const { expectedScope: omittedScope, ...legacy } = await approval(f, incoming);
    expect(omittedScope).toEqual(expectedScope);
    const saved = { requestId: legacy.requestId, restored: [{ caseId: "case-1", displayId: "old-01" }], replayed: false, freshnessNotice: "Original tenant evidence" };
    f.query.auditLog.findFirst.mockResolvedValue({ organizationId: "org-1", metadata: { requestHash: qualityProfileHash(legacy), result: saved } });
    f.project.organizationId = "org-2"; f.aliases([{ projectId: "project-1", organizationId: "org-2", caseKey: "old" }]);
    f.queries.length = 0;
    for (let attempt = 0; attempt < 2; attempt++) await expect(approveProcedureReimport(f.db, "native-1", legacy, authorized)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.queries).toEqual([]); expect(f.query.testCase.update).not.toHaveBeenCalled(); expect(f.query.auditLog.create).not.toHaveBeenCalled();
  });
  it("fresh current-tenant review can resolve copied historical aliases without transferring an old review or receipt", async () => {
    const f = fixture(); f.project.organizationId = "org-2";
    f.aliases(["old", "new"].map(caseKey => ({ projectId: "project-1", organizationId: "org-2", caseKey })));
    const review = await previewProcedureReimport(f.db, "native-1", { projectId: "project-1", serialized: JSON.stringify(bundle("old")), expectedScope: { organizationId: "org-2", clerkActorId: "Clerk-1" } }, authorized);
    expect(review.organizationId).toBe("org-2"); expect(review.entries[0]!.status).toBe("UNCHANGED"); expect(review.entries[0]!.missingRelationships).toEqual([]);
    expect(f.queries.find(query => query.sql.includes('FROM "ProjectCaseKeyAlias"'))!.values[1]).toBe("org-2");
    expect(f.query.testCase.update).not.toHaveBeenCalled(); expect(f.query.auditLog.create).not.toHaveBeenCalled();
  });
});
