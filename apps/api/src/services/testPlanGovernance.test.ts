import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@vaettir/db";
import type { Context } from "../trpc.js";
import { testPlanGovernanceRouter } from "../routers/testPlanGovernance.js";
import { refreshReleaseReadiness } from "./releaseReadiness.js";
vi.mock("./releaseReadiness.js", () => ({ refreshReleaseReadiness: vi.fn() }));
import {
  previewPlanGovernance,
  editGovernedCriterionDescription,
  setGovernedCriterionVerdict,
  setLegacyCriterionVerdict,
  attachGovernedUnassignedPlan,
  detachGovernedAttachedPlan,
  listPlanGovernanceHistory,
  addGovernedCriterion,
  deleteGovernedCriterion,
  setGovernedCriterionRequirement,
  listGovernanceRequirementChoices,
  editGovernedPlanHeader,
  setGovernedPlanStatus,
  editGovernedPlanCustomFields,
} from "./testPlanGovernance.js";
import {
  MAX_GOVERNANCE_SNAPSHOT_BYTES,
  MAX_GOVERNANCE_RECEIPT_BYTES,
  MAX_GOVERNANCE_HISTORY_REVISIONS,
  editCriterionDescriptionInput,
  editPlanHeaderInput,
  setPlanStatusInput,
  editPlanCustomFieldsInput,
  detachAttachedPlanInput,
} from "./testPlanGovernanceSchema.js";
import {
  governanceRequestHash,
  validatedGovernanceReceipt,
  governancePlanRevision,
  boundedGovernanceSnapshot,
} from "./testPlanGovernanceRevision.js";

function fixture() {
  let state = {
    role: "EDITOR",
    seatType: "FULL",
    suspendedAt: null as Date | null,
    clerkActorId: "clerk",
    nativePlanBytes: 1000n,
    nativeTypeBytes: 1000n,
    nativePatchBytes: 1000n,
    nativeMetadataBytes: 1000n,
    customFieldsExact: true,
    executionTemplateExact: true,
    schemaRoundTripExact: true,
    typeAvailable: true,
    type: {
      id: "regression",
      fieldSchema: {
        type: "object",
        properties: {
          objective: { type: "string" },
          enabled: { type: "boolean" },
          count: { type: "number" },
          areas: { type: "array", items: { type: "string" } },
        },
      },
    } as { id: string; fieldSchema: unknown },
    nativeAuditBytes: null as number | null,
    historyCount: null as number | null,
    hasPlanCases: false,
    requirements: [
      {
        id: "requirement",
        projectId: "project",
        title: "Original synthetic requirement",
      },
      {
        id: "next-requirement",
        projectId: "project",
        title: "Next synthetic requirement",
      },
      {
        id: "foreign-requirement",
        projectId: "foreign",
        title: "Private foreign requirement",
      },
    ],
    requirementPageBytes: 1000n,
    largestRequirementTitle: 100,
    plan: {
      id: "plan",
      projectId: "project",
      testPlanTypeId: "regression",
      releaseId: null as string | null,
      strategyId: "strategy",
      name: "Synthetic plan",
      description: "Retained plan prose" as string | null,
      status: "DRAFT",
      customFields: { unknown: ["preserve"] } as unknown,
      executionTemplate: { opaque: "retained" } as unknown,
      createdById: "creator",
      updatedById: "creator",
      createdAt: new Date("2026-10-05T10:00:00Z"),
      updatedAt: new Date("2026-10-05T10:00:00Z"),
    },
    criteria: [
      {
        id: "criterion",
        testPlanId: "plan",
        requirementId: "requirement" as string | null,
        description: "Original requirement",
        status: "AT_RISK",
        createdAt: new Date("2026-10-05T10:00:00Z"),
      },
    ],
    versions: [{ id: "version-1", versionNumber: 1 }],
    audits: new Map<string, { id: string; metadata: unknown }>(),
    release: { id: "release", projectId: "project", status: "PLANNING" },
  };
  const calls: string[] = [];
  const raw = vi.fn(async (query: unknown, ...values: unknown[]) => {
    const text = Array.isArray(query)
      ? query.join("?")
      : String((query as { sql?: string }).sql ?? query);
    calls.push(text);
    if (text.includes('FROM "User"'))
      return [{ clerkUserId: state.clerkActorId }];
    if (text.includes('FROM "Organization"'))
      return [{ id: "org", suspendedAt: state.suspendedAt }];
    if (text.includes('FROM "Membership"'))
      return [{ id: "member", role: state.role, seatType: state.seatType }];
    if (text.includes('FROM "Project"')) return [{ organizationId: "org" }];
    if (text.includes('AS "customFieldsExact"'))
      return [
        {
          customFieldsExact: state.customFieldsExact,
          executionTemplateExact: state.executionTemplateExact,
        },
      ];
    if (text.includes('FROM "TestPlanType"') && !state.typeAvailable) return [];
    if (text.includes('AS "schemaRoundTripExact"'))
      return [{ schemaRoundTripExact: state.schemaRoundTripExact }];
    if (text.includes('FROM "TestPlanType"'))
      return text.includes("octet_length")
        ? [{ bytes: state.nativeTypeBytes }]
        : [{ id: state.type.id }];
    if (text.includes('AS "patchBytes"'))
      return [
        {
          patchBytes: state.nativePatchBytes,
          resultBytes: state.nativeMetadataBytes,
        },
      ];
    if (text.includes('FROM "TestPlan"') && text.includes("FOR "))
      return values[0] === state.plan.id && values[1] === state.plan.projectId
        ? [{ id: state.plan.id }]
        : [];
    if (text.includes('FROM "Release"'))
      return values[0] === state.release.id &&
        values[1] === state.release.projectId
        ? [state.release]
        : [];
    if (text.includes('FROM "TestPlan" p'))
      return [
        { bytes: state.nativePlanBytes, criteria: state.criteria.length },
      ];
    if (text.includes('FROM "AcceptanceCriterion"'))
      return state.criteria.map((c) => ({ id: c.id }));
    if (text.includes('FROM "TestCase"'))
      return state.hasPlanCases ? [{ id: "case" }] : [];
    if (text.includes('FROM "Requirement"') && text.includes("octet_length"))
      return [
        {
          bytes: state.requirementPageBytes,
          largest: state.largestRequirementTitle,
        },
      ];
    if (text.includes('FROM "Requirement"'))
      return state.requirements
        .filter((row) => row.id === values[0] && row.projectId === values[1])
        .map((row) => ({ id: row.id }));
    if (text.includes("SELECT id,octet_length(metadata")) {
      const row = state.audits.get(values[0] as string);
      return row
        ? [
            {
              id: row.id,
              bytes: Buffer.byteLength(JSON.stringify(row.metadata)),
            },
          ]
        : [];
    }
    if (text.includes("SELECT count(*)::int AS count"))
      return [
        {
          count: state.historyCount ?? state.audits.size,
          bytes: BigInt(
            [...state.audits.values()].reduce(
              (sum, row) =>
                sum + Buffer.byteLength(JSON.stringify(row.metadata)),
              0,
            ),
          ),
        },
      ];
    if (text.includes("coalesce(max(octet_length"))
      return [{ bytes: 1000n, largest: state.nativeAuditBytes ?? 1000 }];
    if (text.includes("SELECT octet_length(metadata")) {
      const row = state.audits.get(values[0] as string);
      return row
        ? [
            {
              bytes:
                state.nativeAuditBytes ??
                Buffer.byteLength(JSON.stringify(row.metadata)),
            },
          ]
        : [];
    }
    return [];
  });
  const tx = {
    $queryRaw: raw,
    $executeRaw: vi.fn(async () => 0),
    project: {
      findUnique: vi.fn(async () => ({
        organizationId: "org",
        organization: { suspendedAt: state.suspendedAt },
      })),
      findUniqueOrThrow: vi.fn(async () => ({ organizationId: "org" })),
    },
    membership: {
      findUnique: vi.fn(async () => ({
        role: state.role,
        seatType: state.seatType,
      })),
      findUniqueOrThrow: vi.fn(async () => ({
        role: state.role,
        seatType: state.seatType,
      })),
    },
    testPlan: {
      findFirstOrThrow: vi.fn(async () =>
        structuredClone({
          ...state.plan,
          acceptanceCriteria: [...state.criteria].sort((a, b) =>
            a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
          ),
          versions: state.versions.slice(-1).map((version) => ({
            id: version.id,
            versionNumber: version.versionNumber,
          })),
        }),
      ),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(state.plan, data);
        state.plan.updatedAt = new Date(state.plan.updatedAt.getTime() + 1);
        return structuredClone(state.plan);
      }),
      updateMany: vi.fn(async ({where,data}:{where:{id:string;projectId:string;releaseId:string|null};data:{releaseId:string|null;updatedById:string}}) => {
        if (state.plan.id !== where.id || state.plan.projectId !== where.projectId || state.plan.releaseId !== where.releaseId) return { count: 0 };
        state.plan.releaseId = data.releaseId;
        state.plan.updatedById = data.updatedById;
        return { count: 1 };
      }),
    },
    testPlanType: {
      findUnique: vi.fn(async () => ({ fieldSchema: state.type.fieldSchema })),
    },
    acceptanceCriterion: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          state.criteria.find((row) => row.id === where.id) ?? null,
      ),
      create: vi.fn(
        async ({ data }: { data: (typeof state.criteria)[number] }) => {
          const created = {
            ...data,
            createdAt: new Date("2026-10-05T10:00:02Z"),
          };
          state.criteria.push(created);
          return created;
        },
      ),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const index = state.criteria.findIndex((row) => row.id === where.id);
        return state.criteria.splice(index, 1)[0];
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: {
            description?: string;
            status?: string;
            requirementId?: string | null;
          };
        }) => {
          const target = state.criteria.find((row) => row.id === where.id)!;
          Object.assign(target, data);
          return target;
        },
      ),
    },
    requirement: {
      findMany: vi.fn(
        async ({
          where,
          select,
          take,
        }: {
          where: {
            projectId: string;
            id?: { in?: string[]; gt?: string };
            OR?: Array<Record<string, { contains: string }>>;
          };
          select: { title?: boolean };
          take?: number;
        }) => {
          let rows = state.requirements.filter(
            (row) => row.projectId === where.projectId,
          );
          if (where.id?.in)
            rows = rows.filter((row) => where.id!.in!.includes(row.id));
          if (where.id?.gt) rows = rows.filter((row) => row.id > where.id!.gt!);
          const search = where.OR?.[0]?.id?.contains;
          if (search)
            rows = rows.filter(
              (row) => row.id.includes(search) || row.title.includes(search),
            );
          rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
          if (take !== undefined) rows = rows.slice(0, take);
          return rows.map((row) =>
            select.title ? { id: row.id, title: row.title } : { id: row.id },
          );
        },
      ),
    },
    testPlanVersion: {
      findFirst: vi.fn(async () => state.versions.at(-1)),
      create: vi.fn(async ({ data }: { data: { versionNumber: number } }) => {
        const version = { ...data, id: `version-${data.versionNumber}` };
        state.versions.push(version);
        return version;
      }),
    },
    auditLog: {
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) =>
        state.audits.get(where.id),
      ),
      findMany: vi.fn(async () =>
        [...state.audits.values()].map((row) => ({
          ...row,
          createdAt: new Date("2026-10-05T10:00:01Z"),
        })),
      ),
      create: vi.fn(
        async ({ data }: { data: { id: string; metadata: unknown } }) => {
          state.audits.set(data.id, structuredClone(data));
          return data;
        },
      ),
    },
  };
  const db = {
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      const saved = structuredClone(state);
      try {
        return await callback(tx);
      } catch (cause) {
        state = saved;
        throw cause;
      }
    },
  } as unknown as PrismaClient;
  const scope = {
    projectId: "project",
    testPlanId: "plan",
    originalOrganizationId: "org",
    expectedClerkActorId: "clerk",
  };
  const preview = () =>
    previewPlanGovernance(db, "actor", scope, { clerkActorId: "clerk" });
  const edit = async () => {
    const baseline = await preview();
    return {
      ...scope,
      requestId: "fd14eb16-af5d-4cb8-914b-c5412b5f6181",
      expectedPlanRevision: baseline.planRevision,
      reason: "Clarify synthetic wording",
      confirmed: true as const,
      criterionId: "criterion",
      expectedCriterionRevision: baseline.criterionRevisions.criterion!,
      description: "Reviewed requirement",
    };
  };
  return { db, tx, scope, calls, preview, edit, state: () => state };
}
describe("reviewed attached-plan detach (actual service, mocked transactions only)", () => {
  async function inputFor(f: ReturnType<typeof fixture>) {
    f.state().plan.releaseId = "release";
    return { ...f.scope, expectedPlanRevision: (await f.preview()).planRevision, expectedReleaseId: "release", releaseId: null,
      requestId: "46b926fe-cf36-4bc1-a0d3-c615fbac3dd1", reason: "Detach this reviewed synthetic scope", confirmed: true as const };
  }
  it("detaches exact planning scope with one CAS/version/complete before-after receipt and unchanged criteria/prose/procedures", async () => {
    const f=fixture(), input=await inputFor(f), before=(await f.preview()).snapshot;
    f.calls.length=0;
    const ack=await detachGovernedAttachedPlan(f.db,"actor",input,{clerkActorId:"clerk"});
    expect(ack).toMatchObject({operation:"DETACH_ATTACHED_PLAN",releaseId:null,criterionId:null,requestId:input.requestId,versionNumber:2,replayed:false});
    expect(ack.requestHash).toBe(governanceRequestHash({operation:"DETACH_ATTACHED_PLAN",input}));
    expect(f.tx.testPlan.updateMany).toHaveBeenCalledExactlyOnceWith({where:{id:"plan",projectId:"project",releaseId:"release"},data:{releaseId:null,updatedById:"actor"}});
    expect(f.tx.testPlanVersion.create).toHaveBeenCalledOnce();expect(f.state().audits.size).toBe(1);
    const receipt=validatedGovernanceReceipt([...f.state().audits.values()][0]!.metadata);
    expect(receipt.before).toEqual(before);expect(receipt.after.releaseId).toBeNull();
    for(const key of ["criteria","name","description","customFields","executionTemplate","strategyId","status","testPlanTypeId","createdAt","createdById"] as const)
      expect(receipt.after[key]).toEqual(before[key]);
    expect(receipt.ack.requestHash).toBe(ack.requestHash);expect(receipt.ack.afterRevision).toBe(governancePlanRevision(receipt.after));
    expect(f.calls.findIndex(sql=>sql.includes('FROM "TestPlan"')&&sql.includes("FOR UPDATE"))).toBeLessThan(f.calls.findIndex(sql=>sql.includes('FROM "Release"')&&sql.includes("FOR SHARE")));
  });
  it.each(["DRAFT","ACTIVE","IN_REVIEW"])("mutable plan %s can detach without changing its lifecycle",async status=>{
    const f=fixture();f.state().plan.status=status;const input=await inputFor(f);
    expect((await detachGovernedAttachedPlan(f.db,"actor",input,{clerkActorId:"clerk"})).releaseId).toBeNull();expect(f.state().plan.status).toBe(status);
  });
  it.each(["APPROVED","ARCHIVED"])("frozen plan %s refuses a new detach without changing approval or evidence",async status=>{
    const f=fixture();f.state().plan.status=status;const input=await inputFor(f),before=structuredClone(f.state());
    await expect(detachGovernedAttachedPlan(f.db,"actor",input,{clerkActorId:"clerk"})).rejects.toMatchObject({code:"CONFLICT"});
    expect(f.state()).toEqual(before);expect(f.tx.testPlan.updateMany).not.toHaveBeenCalled();
  });
  it.each(["READY","SHIPPED","IN_TESTING","BLOCKED"])("source release %s cannot lose quality scope until explicitly PLANNING",async status=>{
    const f=fixture(),input=await inputFor(f);f.state().release.status=status;const before=structuredClone(f.state());
    await expect(detachGovernedAttachedPlan(f.db,"actor",input,{clerkActorId:"clerk"})).rejects.toMatchObject({code:"CONFLICT"});
    expect(f.state()).toEqual(before);expect(f.tx.testPlan.updateMany).not.toHaveBeenCalled();
  });
  it.each(["missing","foreign"])("%s same-project source release cannot be detached",async mode=>{
    const f=fixture(),input=await inputFor(f);if(mode==="missing")f.state().release.id="different";else f.state().release.projectId="foreign";
    const before=structuredClone(f.state());await expect(detachGovernedAttachedPlan(f.db,"actor",input,{clerkActorId:"clerk"})).rejects.toMatchObject({code:"NOT_FOUND"});expect(f.state()).toEqual(before);
  });
  it("changed plan revision or original assignment refuses without updating another release",async()=>{
    for(const change of ["revision","assignment"]){
      const f=fixture(),input=await inputFor(f);if(change==="revision")f.state().plan.description="Later manual edit";else f.state().plan.releaseId="another-release";
      const before=structuredClone(f.state());await expect(detachGovernedAttachedPlan(f.db,"actor",input,{clerkActorId:"clerk"})).rejects.toMatchObject({code:"CONFLICT"});
      expect(f.state()).toEqual(before);expect(f.tx.testPlan.updateMany).not.toHaveBeenCalled();
    }
  });
  it("conditional old-release selector must change exactly one row or the complete attempt rolls back",async()=>{
    const f=fixture(),input=await inputFor(f),before=structuredClone(f.state());f.tx.testPlan.updateMany.mockResolvedValueOnce({count:0});
    await expect(detachGovernedAttachedPlan(f.db,"actor",input,{clerkActorId:"clerk"})).rejects.toMatchObject({code:"CONFLICT"});
    expect(f.state()).toEqual(before);expect(f.tx.testPlanVersion.create).not.toHaveBeenCalled();expect(f.state().audits.size).toBe(0);
  });
  it("accepted exact UUID replay precedes later plan/release/CAS/codec budgets and cannot detach a later reassignment",async()=>{
    const f=fixture(),input=await inputFor(f),ack=await detachGovernedAttachedPlan(f.db,"actor",input,{clerkActorId:"clerk"});
    f.state().plan.releaseId="later-release";f.state().plan.status="APPROVED";f.state().plan.description="Later exact prose";f.state().release.status="SHIPPED";
    f.state().customFieldsExact=false;f.state().nativePlanBytes=999999n;f.state().historyCount=MAX_GOVERNANCE_HISTORY_REVISIONS;
    expect(await detachGovernedAttachedPlan(f.db,"actor",input,{clerkActorId:"clerk"})).toEqual({...ack,replayed:true});
    expect(f.state().plan.releaseId).toBe("later-release");expect(f.state().plan.description).toBe("Later exact prose");
    expect(f.tx.testPlan.updateMany).toHaveBeenCalledOnce();expect(f.tx.testPlanVersion.create).toHaveBeenCalledOnce();expect(f.state().audits.size).toBe(1);
    await expect(detachGovernedAttachedPlan(f.db,"actor",{...input,expectedReleaseId:"later-release"},{clerkActorId:"clerk"})).rejects.toMatchObject({code:"CONFLICT"});
  });
  it.each(["role","seat","suspension","actor","organization"])("current %s revocation refuses both new detach and receipt replay",async mode=>{
    for(const replay of [false,true]){
      const f=fixture(),input=await inputFor(f);if(replay)await detachGovernedAttachedPlan(f.db,"actor",input,{clerkActorId:"clerk"});
      if(mode==="role")f.state().role="VIEWER";if(mode==="seat")f.state().seatType="READ_ONLY";if(mode==="suspension")f.state().suspendedAt=new Date();
      if(mode==="actor")f.state().clerkActorId="remapped";if(mode==="organization")f.tx.project.findUniqueOrThrow.mockResolvedValueOnce({organizationId:"different-org"});
      const before=structuredClone(f.state());await expect(detachGovernedAttachedPlan(f.db,"actor",input,{clerkActorId:"clerk"})).rejects.toMatchObject({code:"FORBIDDEN"});expect(f.state()).toEqual(before);
      expect(f.tx.testPlan.updateMany).toHaveBeenCalledTimes(replay?1:0);
    }
  });
  it.each(["history","snapshot","codec","native-receipt"])("%s admission failure retains complete plan/criteria/version/receipt state",async mode=>{
    const f=fixture(),input=await inputFor(f);
    if(mode==="history")f.state().historyCount=MAX_GOVERNANCE_HISTORY_REVISIONS;
    if(mode==="snapshot")f.state().nativePlanBytes=BigInt(MAX_GOVERNANCE_SNAPSHOT_BYTES+1);
    if(mode==="codec")f.state().executionTemplateExact=false;
    if(mode==="native-receipt")f.state().nativeAuditBytes=MAX_GOVERNANCE_RECEIPT_BYTES+1;
    const before=structuredClone(f.state());await expect(detachGovernedAttachedPlan(f.db,"actor",input,{clerkActorId:"clerk"})).rejects.toMatchObject({code:"PRECONDITION_FAILED"});expect(f.state()).toEqual(before);
  });
  it("sequential model of competing captured revisions preserves the first winner; native concurrency remains separately unproved",async()=>{
    const f=fixture(),first=await inputFor(f),second={...first,requestId:"393ca86f-9c46-4160-8273-62705cb367cc"};
    const ack=await detachGovernedAttachedPlan(f.db,"actor",first,{clerkActorId:"clerk"}),before=structuredClone(f.state());
    await expect(detachGovernedAttachedPlan(f.db,"actor",second,{clerkActorId:"clerk"})).rejects.toMatchObject({code:"CONFLICT"});
    expect(f.state()).toEqual(before);expect(f.tx.testPlan.updateMany).toHaveBeenCalledOnce();expect(f.state().versions.at(-1)?.id).toBe(ack.versionId);
  });
  it("strict detach input rejects null/missing source, nonnull destination, hidden fields or unconfirmed/blank intent",async()=>{
    const f=fixture(),input=await inputFor(f);
    for(const invalid of [{...input,expectedReleaseId:null},{...input,expectedReleaseId:undefined},{...input,releaseId:"other"},{...input,releaseId:undefined},
      {...input,confirmed:false},{...input,reason:"   "},{...input,unreviewed:true}])expect(detachAttachedPlanInput.safeParse(invalid).success).toBe(false);
    expect(detachAttachedPlanInput.parse(input)).toEqual(input);expect(f.tx.testPlan.updateMany).not.toHaveBeenCalled();
  });
  it("forged null transition/source/hash/operation/unrelated prose cannot validate even after revision recomputation",async()=>{
    const f=fixture(),input=await inputFor(f);await detachGovernedAttachedPlan(f.db,"actor",input,{clerkActorId:"clerk"});
    const receipt=validatedGovernanceReceipt([...f.state().audits.values()][0]!.metadata);
    const mutations:Array<(value:typeof receipt)=>void>=[
      value=>{value.before.releaseId=null;},value=>{value.after.releaseId="different";value.ack.releaseId="different";},value=>{value.before.releaseId="different-source";},
      value=>{value.ack.requestHash="a".repeat(64);},value=>{value.ack.operation="ATTACH_UNASSIGNED_PLAN";},value=>{value.after.description="forged manual prose";},
      value=>{value.after.criteria[0]!.status="MET";},value=>{value.ack.criterionId="criterion";},value=>{value.reason="different reason";},
    ];
    for(const change of mutations){const forged=structuredClone(receipt);change(forged);forged.ack.beforeRevision=governancePlanRevision(forged.before);forged.ack.afterRevision=governancePlanRevision(forged.after);
      expect(()=>validatedGovernanceReceipt(forged)).toThrow();}
  });
  it("historical v1 attachment hash and receipt replay remain exact after later changed assignment/status",async()=>{
    const f=fixture(),input={...f.scope,expectedPlanRevision:(await f.preview()).planRevision,requestId:"e0bf661c-d183-4978-8f94-56f297f0cc3c",reason:"Original attachment",confirmed:true as const,releaseId:"release",expectedReleaseId:null};
    const ack=await attachGovernedUnassignedPlan(f.db,"actor",input,{clerkActorId:"clerk"});
    expect(ack.requestHash).toBe(governanceRequestHash({operation:"ATTACH_UNASSIGNED_PLAN",input}));
    expect(validatedGovernanceReceipt([...f.state().audits.values()][0]!.metadata).format).toBe("PlanGovernance/v1");
    f.state().plan.status="ARCHIVED";f.state().plan.releaseId="later-release";f.state().release.status="SHIPPED";
    expect(await attachGovernedUnassignedPlan(f.db,"actor",input,{clerkActorId:"clerk"})).toEqual({...ack,replayed:true});
    expect(f.state().plan.releaseId).toBe("later-release");expect(f.tx.testPlan.updateMany).toHaveBeenCalledOnce();
  });
  it("current read-only governance history retains the complete detach transition without granting replay or editing",async()=>{
    const f=fixture(),input=await inputFor(f);await detachGovernedAttachedPlan(f.db,"actor",input,{clerkActorId:"clerk"});
    f.state().role="VIEWER";f.state().seatType="READ_ONLY";
    const history=await listPlanGovernanceHistory(f.db,"actor",{...f.scope,take:5},{clerkActorId:"clerk"});
    expect(history.entries).toHaveLength(1);expect(history.entries[0]!.receipt.ack.operation).toBe("DETACH_ATTACHED_PLAN");
    expect(history.entries[0]!.receipt.before.releaseId).toBe("release");expect(history.entries[0]!.receipt.after.releaseId).toBeNull();
    expect(history.entries[0]!.receipt.after.criteria).toEqual(history.entries[0]!.receipt.before.criteria);
    await expect(detachGovernedAttachedPlan(f.db,"actor",input,{clerkActorId:"clerk"})).rejects.toMatchObject({code:"FORBIDDEN"});expect(f.tx.testPlan.updateMany).toHaveBeenCalledOnce();
  });
  function caller(f:ReturnType<typeof fixture>,subject:string|null|undefined){
    Object.assign(f.db,{project:f.tx.project,organization:{findUnique:async()=>({suspendedAt:f.state().suspendedAt})}});
    const user={id:"actor",clerkUserId:"clerk",email:"synthetic@example.invalid",memberships:[{organizationId:"org",role:"EDITOR",seatType:"FULL"}]};
    return testPlanGovernanceRouter.createCaller({prisma:f.db,user,authenticatedClerkSubject:subject,staff:null,securityLogger:undefined,staffAttempt:{tokenConfigured:false,tokenPresented:false,actorHeaderPresented:false}} as unknown as Context);
  }
  it("registered endpoint refreshes only the exact old source readiness after a new commit, not receipt replay",async()=>{
    vi.mocked(refreshReleaseReadiness).mockClear();const f=fixture(),input=await inputFor(f),route=caller(f,"clerk");
    const ack=await route.detachAttachedPlan(input);expect(ack.releaseId).toBeNull();expect(refreshReleaseReadiness).toHaveBeenCalledExactlyOnceWith(f.db,"release");
    expect(await route.detachAttachedPlan(input)).toEqual({...ack,replayed:true});expect(refreshReleaseReadiness).toHaveBeenCalledOnce();
  });
  it.each([undefined,null,"different-subject"])("registered endpoint independently verified subject %s cannot be inferred from the cached native user",async subject=>{
    vi.mocked(refreshReleaseReadiness).mockClear();const f=fixture(),input=await inputFor(f);
    await expect(caller(f,subject).detachAttachedPlan(input)).rejects.toMatchObject({code:"FORBIDDEN"});expect(f.tx.testPlan.updateMany).not.toHaveBeenCalled();expect(refreshReleaseReadiness).not.toHaveBeenCalled();
  });
});

describe("dedicated bounded plan governance (mocked transactions, not native acceptance)", () => {
  const newCriterionId = "5a3c96dc-022c-4cee-934b-cde38b710d2f";
  async function headerInput(f: ReturnType<typeof fixture>) {
    return {
      ...f.scope,
      expectedPlanRevision: (await f.preview()).planRevision,
      requestId: "6ee2ec04-4d34-40bf-b0e9-d12bb1b851d3",
      reason: "Reviewed synthetic header",
      confirmed: true as const,
    };
  }
  it("header description-only edits preserve exact raw name/status/JSON/criteria/assignment and NULL JSON snapshots", async () => {
    const f = fixture();
    f.state().plan.customFields = null;
    f.state().plan.executionTemplate = null;
    f.state().plan.status = "ACTIVE";
    const input = {
      ...(await headerInput(f)),
      description: "  Raw header prose\nwith exact whitespace.  \n",
    };
    const before = (await f.preview()).snapshot;
    const ack = await editGovernedPlanHeader(f.db, "actor", input, {
      clerkActorId: "clerk",
    });
    expect(f.tx.testPlan.update).toHaveBeenCalledWith({
      where: { id: "plan" },
      data: { description: input.description, updatedById: "actor" },
    });
    const saved = validatedGovernanceReceipt(
      [...f.state().audits.values()][0]!.metadata,
    );
    expect(saved.after).toMatchObject({
      name: before.name,
      status: "ACTIVE",
      customFields: null,
      executionTemplate: null,
      releaseId: before.releaseId,
      criteria: before.criteria,
      description: input.description,
    });
    expect(ack.criterionId).toBeNull();
  });
  it("optional header fields distinguish absent, empty string and explicit description NULL", async () => {
    for (const description of [null, ""]) {
      const f = fixture();
      await editGovernedPlanHeader(
        f.db,
        "actor",
        { ...(await headerInput(f)), description },
        { clerkActorId: "clerk" },
      );
      expect(f.state().plan.description).toBe(description);
      expect(f.state().plan.name).toBe("Synthetic plan");
    }
    const f = fixture(),
      input = {
        ...(await headerInput(f)),
        name: "  New exact name  ",
        description: undefined,
      };
    const parsed = editPlanHeaderInput.parse(input);
    expect(Object.hasOwn(parsed, "description")).toBe(false);
    await editGovernedPlanHeader(f.db, "actor", input, {
      clerkActorId: "clerk",
    });
    expect(f.state().plan.name).toBe(input.name);
    expect(f.state().plan.description).toBe("Retained plan prose");
    expect(f.tx.testPlan.update).toHaveBeenCalledWith({
      where: { id: "plan" },
      data: { name: input.name, updatedById: "actor" },
    });
  });
  it("header exact replay settles before newer approval/CAS state without overwriting newer prose", async () => {
    const f = fixture(),
      input = { ...(await headerInput(f)), name: "Reviewed rename" };
    const first = await editGovernedPlanHeader(f.db, "actor", input, {
      clerkActorId: "clerk",
    });
    f.state().plan.status = "APPROVED";
    f.state().plan.name = "Newer reviewed name";
    expect(
      await editGovernedPlanHeader(f.db, "actor", input, {
        clerkActorId: "clerk",
      }),
    ).toEqual({ ...first, replayed: true });
    expect(f.state().plan.name).toBe("Newer reviewed name");
    expect(f.tx.testPlan.update).toHaveBeenCalledTimes(1);
    await expect(
      editGovernedPlanHeader(
        f.db,
        "actor",
        { ...input, name: "Different intent" },
        { clerkActorId: "clerk" },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("header schema rejects unknown write fields and blank/bounded input and never invents default patches", async () => {
    const f = fixture(),
      common = await headerInput(f);
    for (const patch of [
      {},
      { name: undefined, description: undefined },
      { name: " \n " },
      { name: "x".repeat(10001) },
      { description: "x".repeat(40001) },
      { name: "Allowed", status: "APPROVED" },
      { name: "Allowed", customFields: {} },
      { description: null, releaseId: "other" },
    ])
      expect(() =>
        editPlanHeaderInput.parse({ ...common, ...patch }),
      ).toThrow();
    expect(
      editPlanHeaderInput.parse({
        ...common,
        description: null,
        name: undefined,
      }),
    ).toEqual({ ...common, description: null });
    await expect(
      editGovernedPlanHeader(
        f.db,
        "actor",
        { ...common, name: f.state().plan.name },
        { clerkActorId: "clerk" },
      ),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(f.tx.testPlan.update).not.toHaveBeenCalled();
    expect(f.state().audits.size).toBe(0);
  });
  it("header CAS includes native criteria and current original actor/role checks precede retained receipt bodies", async () => {
    const f = fixture(),
      input = { ...(await headerInput(f)), description: "Reviewed prose" };
    f.state().criteria[0]!.status = "MET";
    await expect(
      editGovernedPlanHeader(f.db, "actor", input, { clerkActorId: "clerk" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.state().plan.description).toBe("Retained plan prose");
    for (const changed of [
      { role: "VIEWER" },
      { seatType: "READ_ONLY" },
      { suspendedAt: new Date() },
      { clerkActorId: "another" },
    ]) {
      const g = fixture(),
        next = { ...(await headerInput(g)), name: "Reviewed name" };
      await editGovernedPlanHeader(g.db, "actor", next, {
        clerkActorId: "clerk",
      });
      Object.assign(g.state(), changed);
      g.calls.length = 0;
      await expect(
        editGovernedPlanHeader(g.db, "actor", next, { clerkActorId: "clerk" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(g.calls.some((call) => call.includes('FROM "AuditLog"'))).toBe(
        false,
      );
    }
  });
  it("header editing cannot implicitly reopen an approved/archived plan or ready/shipped release", async () => {
    for (const status of ["APPROVED", "ARCHIVED"]) {
      const f = fixture();
      f.state().plan.status = status;
      await expect(
        editGovernedPlanHeader(
          f.db,
          "actor",
          { ...(await headerInput(f)), name: "Changed" },
          { clerkActorId: "clerk" },
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(f.state().plan.status).toBe(status);
    }
    for (const status of ["READY", "SHIPPED"]) {
      const f = fixture();
      f.state().plan.releaseId = "release";
      f.state().release.status = status;
      await expect(
        editGovernedPlanHeader(
          f.db,
          "actor",
          { ...(await headerInput(f)), description: null },
          { clerkActorId: "clerk" },
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(f.state().plan.description).toBe("Retained plan prose");
    }
  });
  it("header receipts reject status/JSON/assignment/criteria changes even if forged after hashes match", async () => {
    const f = fixture();
    await editGovernedPlanHeader(
      f.db,
      "actor",
      { ...(await headerInput(f)), name: "Header changed" },
      { clerkActorId: "clerk" },
    );
    for (const field of [
      "status",
      "customFields",
      "executionTemplate",
      "releaseId",
      "criteria",
    ]) {
      const receipt = validatedGovernanceReceipt(
        structuredClone([...f.state().audits.values()][0]!.metadata),
      );
      if (field === "status") receipt.after.status = "APPROVED";
      if (field === "customFields")
        receipt.after.customFields = { discarded: true };
      if (field === "executionTemplate") receipt.after.executionTemplate = [];
      if (field === "releaseId") {
        receipt.after.releaseId = "other";
        receipt.ack.releaseId = "other";
      }
      if (field === "criteria") receipt.after.criteria = [];
      receipt.ack.afterRevision = governanceRequestHash(receipt.after);
      expect(() => validatedGovernanceReceipt(receipt)).toThrow();
    }
  });
  it("unmarked accepted UUIDs preserve the exact historical trim/hash/replay contract", async () => {
    const f = fixture(),
      raw = {
        ...(await f.edit()),
        description: " \n  Legacy accepted wording  \t",
      };
    const normalized = { ...raw, description: raw.description.trim() };
    const parsed = editCriterionDescriptionInput.parse(raw);
    expect(parsed).toEqual(normalized);
    expect(Object.hasOwn(parsed, "wordingMode")).toBe(false);
    const expectedHash = governanceRequestHash({
      operation: "EDIT_CRITERION_DESCRIPTION",
      input: normalized,
    });
    const first = await editGovernedCriterionDescription(f.db, "actor", raw, {
      clerkActorId: "clerk",
    });
    expect(first.requestHash).toBe(expectedHash);
    expect(f.state().criteria[0]!.description).toBe("Legacy accepted wording");
    f.state().criteria[0]!.description = "A newer retained human edit";
    expect(
      await editGovernedCriterionDescription(f.db, "actor", raw, {
        clerkActorId: "clerk",
      }),
    ).toEqual({ ...first, replayed: true });
    expect(f.state().criteria[0]!.description).toBe(
      "A newer retained human edit",
    );
    expect(f.tx.acceptanceCriterion.update).toHaveBeenCalledTimes(1);
    await expect(
      editGovernedCriterionDescription(
        f.db,
        "actor",
        { ...raw, wordingMode: "EXACT" },
        { clerkActorId: "clerk" },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("EXACT explicitly opts into raw wording and its complete marked request hash", async () => {
    const f = fixture(),
      input = {
        ...(await f.edit()),
        wordingMode: "EXACT" as const,
        description: " \n Exact raw prose \t",
      };
    expect(editCriterionDescriptionInput.parse(input)).toEqual(input);
    const first = await editGovernedCriterionDescription(f.db, "actor", input, {
      clerkActorId: "clerk",
    });
    expect(first.requestHash).toBe(
      governanceRequestHash({ operation: "EDIT_CRITERION_DESCRIPTION", input }),
    );
    expect(f.state().criteria[0]!.description).toBe(input.description);
    expect(
      await editGovernedCriterionDescription(f.db, "actor", input, {
        clerkActorId: "clerk",
      }),
    ).toEqual({ ...first, replayed: true });
  });
  it("legacy length checks occur after trimming without injecting a marker; EXACT length checks retain raw input", async () => {
    const f = fixture(),
      input = await f.edit(),
      padded = " ".repeat(2100) + "X" + "\n".repeat(2100);
    expect(
      editCriterionDescriptionInput.parse({ ...input, description: padded }),
    ).toEqual({ ...input, description: "X" });
    expect(
      editCriterionDescriptionInput.parse({
        ...input,
        wordingMode: undefined,
        description: padded,
      }),
    ).toEqual({ ...input, description: "X" });
    expect(() =>
      editCriterionDescriptionInput.parse({
        ...input,
        wordingMode: "EXACT",
        description: padded,
      }),
    ).toThrow();
    for (const mode of [undefined, "EXACT"]) {
      const marked = mode === undefined ? {} : { wordingMode: mode };
      for (const description of [" \n\t ", "X".repeat(2001)])
        expect(() =>
          editCriterionDescriptionInput.parse({
            ...input,
            ...marked,
            description,
          }),
        ).toThrow();
    }
    expect(() =>
      editCriterionDescriptionInput.parse({
        ...input,
        unexpected: "Do not strip unknown keys",
      }),
    ).toThrow();
    expect(() =>
      editCriterionDescriptionInput.parse({ ...input, wordingMode: "TRIM" }),
    ).toThrow();
  });
  async function addInput(f: ReturnType<typeof fixture>) {
    return {
      ...f.scope,
      requestId: "96e3a16d-6f55-4d81-a757-d6403ab95393",
      expectedPlanRevision: (await f.preview()).planRevision,
      reason: "Add synthetic criterion",
      confirmed: true as const,
      criterionId: newCriterionId,
      description: "Synthetic new acceptance criterion",
      requirementId: "next-requirement",
    };
  }
  async function collectionInput(f: ReturnType<typeof fixture>) {
    const baseline = await f.preview();
    return {
      ...f.scope,
      requestId: "ea029bed-8d4d-42e7-a988-e76558e4ab3b",
      expectedPlanRevision: baseline.planRevision,
      reason: "Review synthetic criterion collection",
      confirmed: true as const,
      criterionId: "criterion",
      expectedCriterionRevision: baseline.criterionRevisions.criterion!,
      expectedRequirementId: baseline.snapshot.criteria.find(
        (c) => c.id === "criterion",
      )!.requirementId,
    };
  }
  it("adds one exact pending identity without renumbering or changing retained criteria and replays once", async () => {
    const f = fixture(),
      input = await addInput(f),
      retained = structuredClone(f.state().criteria[0]);
    const first = await addGovernedCriterion(f.db, "actor", input, {
      clerkActorId: "clerk",
    });
    expect(
      f.state().criteria.find((c) => c.id === newCriterionId),
    ).toMatchObject({
      id: newCriterionId,
      status: "PENDING",
      requirementId: "next-requirement",
    });
    expect(f.state().criteria.find((c) => c.id === "criterion")).toEqual(
      retained,
    );
    expect(
      await addGovernedCriterion(f.db, "actor", input, {
        clerkActorId: "clerk",
      }),
    ).toEqual({ ...first, replayed: true });
    expect(f.tx.acceptanceCriterion.create).toHaveBeenCalledTimes(1);
    expect(
      validatedGovernanceReceipt([...f.state().audits.values()][0]!.metadata)
        .before.criteria,
    ).toHaveLength(1);
    await expect(
      addGovernedCriterion(
        f.db,
        "actor",
        { ...input, description: "Different UUID intent" },
        { clerkActorId: "clerk" },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("raw multiline whitespace round-trips for added and edited wording while whitespace-only submissions are refused", async () => {
    const raw = "  First line, with commas\n\nSecond line.  \n";
    const f = fixture(),
      input = { ...(await addInput(f)), description: raw };
    const ack = await addGovernedCriterion(f.db, "actor", input, {
      clerkActorId: "clerk",
    });
    expect(
      f.state().criteria.find((c) => c.id === newCriterionId)!.description,
    ).toBe(raw);
    expect(
      await addGovernedCriterion(f.db, "actor", input, {
        clerkActorId: "clerk",
      }),
    ).toEqual({ ...ack, replayed: true });
    const g = fixture(),
      edit = {
        ...(await g.edit()),
        description: raw,
        wordingMode: "EXACT" as const,
      };
    await editGovernedCriterionDescription(g.db, "actor", edit, {
      clerkActorId: "clerk",
    });
    expect(g.state().criteria[0]!.description).toBe(raw);
    expect(
      validatedGovernanceReceipt([...g.state().audits.values()][0]!.metadata)
        .after.criteria[0]!.description,
    ).toBe(raw);
    const h = fixture();
    const blankAdd = { ...(await addInput(h)), description: " \n\t " },
      blankEdit = { ...(await h.edit()), description: " \n\t " };
    expect(() =>
      addGovernedCriterion(h.db, "actor", blankAdd, { clerkActorId: "clerk" }),
    ).toThrow();
    expect(() =>
      editGovernedCriterionDescription(h.db, "actor", blankEdit, {
        clerkActorId: "clerk",
      }),
    ).toThrow();
    expect(h.tx.acceptanceCriterion.create).not.toHaveBeenCalled();
    expect(h.tx.acceptanceCriterion.update).not.toHaveBeenCalled();
  });
  it("retains the complete raw deleted row in history and exact delete replay cannot remove another criterion", async () => {
    const f = fixture();
    f.state().criteria[0]!.description =
      "  Exact original\nwording, with commas  ";
    const input = await collectionInput(f),
      original = structuredClone(f.state().criteria[0]);
    const first = await deleteGovernedCriterion(f.db, "actor", input, {
      clerkActorId: "clerk",
    });
    expect(f.state().criteria).toHaveLength(0);
    expect(
      validatedGovernanceReceipt([...f.state().audits.values()][0]!.metadata)
        .before.criteria[0],
    ).toEqual({ ...original, createdAt: original!.createdAt.toISOString() });
    expect(
      await deleteGovernedCriterion(f.db, "actor", input, {
        clerkActorId: "clerk",
      }),
    ).toEqual({ ...first, replayed: true });
    expect(f.tx.acceptanceCriterion.delete).toHaveBeenCalledTimes(1);
  });
  it("links or explicitly unlinks only the requirement while retaining wording and raw native verdict", async () => {
    for (const requirementId of ["next-requirement", null]) {
      const f = fixture(),
        input = { ...(await collectionInput(f)), requirementId };
      await setGovernedCriterionRequirement(f.db, "actor", input, {
        clerkActorId: "clerk",
      });
      expect(f.tx.acceptanceCriterion.update).toHaveBeenCalledWith({
        where: { id: "criterion" },
        data: { requirementId },
      });
      expect(f.state().criteria[0]).toMatchObject({
        description: "Original requirement",
        status: "AT_RISK",
        requirementId,
      });
      validatedGovernanceReceipt([...f.state().audits.values()][0]!.metadata);
    }
  });
  it("refuses foreign requirements for both new and existing criteria before a write", async () => {
    const f = fixture(),
      input = await addInput(f);
    await expect(
      addGovernedCriterion(
        f.db,
        "actor",
        { ...input, requirementId: "foreign-requirement" },
        { clerkActorId: "clerk" },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      setGovernedCriterionRequirement(
        f.db,
        "actor",
        { ...(await collectionInput(f)), requirementId: "foreign-requirement" },
        { clerkActorId: "clerk" },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(f.tx.acceptanceCriterion.create).not.toHaveBeenCalled();
    expect(f.tx.acceptanceCriterion.update).not.toHaveBeenCalled();
    expect(f.tx.requirement.findMany).not.toHaveBeenCalled(); // No foreign title/body materialized.
  });
  it("preserves a legacy raw association rather than quietly repairing it, with explicit unlink available", async () => {
    const f = fixture();
    f.state().criteria[0]!.requirementId = "legacy-foreign-id";
    const input = await collectionInput(f);
    await expect(
      setGovernedCriterionRequirement(
        f.db,
        "actor",
        { ...input, expectedRequirementId: null, requirementId: null },
        { clerkActorId: "clerk" },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await setGovernedCriterionRequirement(
      f.db,
      "actor",
      { ...input, requirementId: null },
      { clerkActorId: "clerk" },
    );
    expect(
      validatedGovernanceReceipt([...f.state().audits.values()][0]!.metadata)
        .before.criteria[0]!.requirementId,
    ).toBe("legacy-foreign-id");
  });
  it("new collection operations recheck original auth and reject stale native associations", async () => {
    for (const change of [
      { role: "VIEWER" },
      { seatType: "READ_ONLY" },
      { suspendedAt: new Date() },
      { clerkActorId: "other" },
    ])
      for (const operation of ["ADD", "DELETE", "LINK"]) {
        const f = fixture(),
          a = await addInput(f),
          c = await collectionInput(f);
        Object.assign(f.state(), change);
        f.calls.length = 0;
        const promise =
          operation === "ADD"
            ? addGovernedCriterion(f.db, "actor", a, { clerkActorId: "clerk" })
            : operation === "DELETE"
              ? deleteGovernedCriterion(f.db, "actor", c, {
                  clerkActorId: "clerk",
                })
              : setGovernedCriterionRequirement(
                  f.db,
                  "actor",
                  { ...c, requirementId: null },
                  { clerkActorId: "clerk" },
                );
        await expect(promise).rejects.toMatchObject({ code: "FORBIDDEN" });
        expect(f.state().audits.size).toBe(0);
      }
    const f = fixture(),
      c = await collectionInput(f);
    f.state().criteria[0]!.requirementId = "concurrent";
    await expect(
      deleteGovernedCriterion(f.db, "actor", c, { clerkActorId: "clerk" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("addition bounds and native receipt expansion roll back without discarding retained criteria", async () => {
    const f = fixture();
    f.state().criteria = Array.from({ length: 200 }, (_, i) => ({
      ...f.state().criteria[0]!,
      id: `retained-${i.toString().padStart(3, "0")}`,
    }));
    const input = await addInput(f);
    await expect(
      addGovernedCriterion(f.db, "actor", input, { clerkActorId: "clerk" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(f.state().criteria).toHaveLength(200);
    const g = fixture(),
      next = await addInput(g);
    g.state().nativeAuditBytes = MAX_GOVERNANCE_RECEIPT_BYTES + 1;
    await expect(
      addGovernedCriterion(g.db, "actor", next, { clerkActorId: "clerk" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(g.state().criteria).toHaveLength(1);
    expect(g.state().versions).toHaveLength(1);
  });
  it("scoped requirement choices are bounded, searchable, stable-ID paged and never return foreign titles", async () => {
    const f = fixture();
    f.state().role = "VIEWER";
    f.state().seatType = "READ_ONLY";
    const page = await listGovernanceRequirementChoices(
      f.db,
      "actor",
      { ...f.scope, take: 1 },
      { clerkActorId: "clerk" },
    );
    expect(page.choices).toEqual([
      { id: "next-requirement", title: "Next synthetic requirement" },
    ]);
    expect(page.nextCursor).toBe("next-requirement");
    const next = await listGovernanceRequirementChoices(
      f.db,
      "actor",
      { ...f.scope, take: 1, cursor: page.nextCursor! },
      { clerkActorId: "clerk" },
    );
    expect(next.choices[0]!.id).toBe("requirement");
    expect(next.nextCursor).toBeNull();
    expect(JSON.stringify(page)).not.toContain("Private foreign");
    const searched = await listGovernanceRequirementChoices(
      f.db,
      "actor",
      { ...f.scope, search: "Original" },
      { clerkActorId: "clerk" },
    );
    expect(searched.choices).toHaveLength(1);
    const reads = f.tx.requirement.findMany.mock.calls.length;
    await expect(
      listGovernanceRequirementChoices(
        f.db,
        "actor",
        { ...f.scope, originalOrganizationId: "foreign" },
        { clerkActorId: "clerk" },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.tx.requirement.findMany.mock.calls).toHaveLength(reads);
  });
  it("refuses oversized native requirement titles before reading their private text body", async () => {
    const f = fixture();
    f.state().largestRequirementTitle = 10001;
    await expect(
      listGovernanceRequirementChoices(f.db, "actor", f.scope, {
        clerkActorId: "clerk",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(f.tx.requirement.findMany).toHaveBeenCalledTimes(1);
    expect(
      f.tx.requirement.findMany.mock.calls[0]![0].select.title,
    ).toBeUndefined();
  });
  it("collection receipts reject duplicate/foreign native criterion rows and unrelated field edits", async () => {
    const f = fixture();
    await addGovernedCriterion(f.db, "actor", await addInput(f), {
      clerkActorId: "clerk",
    });
    for (const corrupt of ["FOREIGN", "UNRELATED", "DUPLICATE"]) {
      const receipt = validatedGovernanceReceipt(
        structuredClone([...f.state().audits.values()][0]!.metadata),
      );
      if (corrupt === "FOREIGN")
        receipt.after.criteria.find(
          (c) => c.id === newCriterionId,
        )!.testPlanId = "foreign-plan";
      if (corrupt === "UNRELATED")
        receipt.after.criteria.find((c) => c.id === "criterion")!.description =
          "Silently changed";
      if (corrupt === "DUPLICATE")
        receipt.after.criteria.push({ ...receipt.after.criteria[0]! });
      receipt.ack.afterRevision = governanceRequestHash(receipt.after);
      expect(() => validatedGovernanceReceipt(receipt)).toThrow();
    }
  });
  async function verdict(f: ReturnType<typeof fixture>) {
    const { description: _description, ...input } = await f.edit();
    return { ...input, status: "MET" as const };
  }
  it("verdict-only mutation preserves exact raw wording/requirement and all unrelated native plan fields", async () => {
    const f = fixture(),
      input = await verdict(f);
    const ack = await setGovernedCriterionVerdict(f.db, "actor", input, {
      clerkActorId: "clerk",
    });
    expect(f.tx.acceptanceCriterion.update).toHaveBeenCalledWith({
      where: { id: "criterion" },
      data: { status: "MET" },
    });
    expect(f.state().criteria[0]).toMatchObject({
      description: "Original requirement",
      requirementId: "requirement",
      status: "MET",
    });
    const saved = validatedGovernanceReceipt(
      [...f.state().audits.values()][0]!.metadata,
    );
    expect(saved.ack.operation).toBe("SET_CRITERION_VERDICT");
    expect(saved.before.criteria[0]!.status).toBe("AT_RISK");
    expect(saved.after.criteria[0]!.status).toBe("MET");
    expect(ack.versionNumber).toBe(2);
  });
  it("exact verdict replay precedes newer approval/case-evidence/CAS state and never records a second decision", async () => {
    const f = fixture(),
      input = await verdict(f),
      first = await setGovernedCriterionVerdict(f.db, "actor", input, {
        clerkActorId: "clerk",
      });
    f.state().plan.status = "APPROVED";
    f.state().hasPlanCases = true;
    expect(
      await setGovernedCriterionVerdict(f.db, "actor", input, {
        clerkActorId: "clerk",
      }),
    ).toEqual({ ...first, replayed: true });
    expect(f.tx.acceptanceCriterion.update).toHaveBeenCalledTimes(1);
    await expect(
      setGovernedCriterionVerdict(
        f.db,
        "actor",
        { ...input, status: "NOT_MET" },
        { clerkActorId: "clerk" },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("refuses verdict updates after raw wording or native status changes", async () => {
    for (const changed of [
      { description: "New governed wording" },
      { status: "NOT_MET" },
      { requirementId: "new-requirement" },
    ]) {
      const f = fixture(),
        input = await verdict(f);
      Object.assign(f.state().criteria[0]!, changed);
      await expect(
        setGovernedCriterionVerdict(f.db, "actor", input, {
          clerkActorId: "clerk",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(f.tx.acceptanceCriterion.update).not.toHaveBeenCalled();
    }
  });
  it("rechecks current actor/role/seat/suspension before verdict receipt replay", async () => {
    for (const changed of [
      { role: "VIEWER" },
      { seatType: "READ_ONLY" },
      { suspendedAt: new Date() },
      { clerkActorId: "other" },
    ]) {
      const f = fixture(),
        input = await verdict(f);
      await setGovernedCriterionVerdict(f.db, "actor", input, {
        clerkActorId: "clerk",
      });
      Object.assign(f.state(), changed);
      f.calls.length = 0;
      await expect(
        setGovernedCriterionVerdict(f.db, "actor", input, {
          clerkActorId: "clerk",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(f.calls.some((call) => call.includes('FROM "AuditLog"'))).toBe(
        false,
      );
    }
  });
  it("does not substitute manual verdicts for effective computed case evidence", async () => {
    const f = fixture(),
      input = await verdict(f);
    f.state().hasPlanCases = true;
    expect(await f.preview()).toMatchObject({ manualVerdicts: false });
    await expect(
      setGovernedCriterionVerdict(f.db, "actor", input, {
        clerkActorId: "clerk",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.state().criteria[0]!.status).toBe("AT_RISK");
    expect(f.state().audits.size).toBe(0);
  });
  it("verdict receipts cannot change wording even when a forged after-hash is recomputed", async () => {
    const f = fixture(),
      input = await verdict(f);
    await setGovernedCriterionVerdict(f.db, "actor", input, {
      clerkActorId: "clerk",
    });
    const saved = validatedGovernanceReceipt(
      [...f.state().audits.values()][0]!.metadata,
    );
    saved.after.criteria[0]!.description = "Silently overwritten";
    saved.ack.afterRevision = governanceRequestHash(saved.after);
    expect(() => validatedGovernanceReceipt(saved)).toThrow(
      "complete scoped snapshot",
    );
  });
  it("legacy status alias never writes supplied wording or requirement and refuses stale/intentional text changes", async () => {
    const f = fixture(),
      input = {
        projectId: "project",
        testPlanId: "plan",
        id: "criterion",
        description: "Original requirement",
        status: "MET" as const,
        requirementId: "requirement",
      };
    await setLegacyCriterionVerdict(f.db, "actor", input, {
      clerkActorId: "clerk",
    });
    expect(f.tx.acceptanceCriterion.update).toHaveBeenCalledWith({
      where: { id: "criterion" },
      data: { status: "MET" },
    });
    expect(f.state().audits.size).toBe(0); // No UUID/history guarantee was invented for legacy input.
    for (const changed of [
      { description: "Old/intentional text edit" },
      { requirementId: null },
    ])
      await expect(
        setLegacyCriterionVerdict(
          f.db,
          "actor",
          { ...input, ...changed },
          { clerkActorId: "clerk" },
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.state().criteria[0]!.description).toBe("Original requirement");
  });
  it("legacy alias shares current role/actor and reopened-state guards", async () => {
    for (const changed of [
      { role: "VIEWER" },
      { clerkActorId: "other" },
      { suspendedAt: new Date() },
      { seatType: "READ_ONLY" },
      { hasPlanCases: true },
    ]) {
      const f = fixture();
      Object.assign(f.state(), changed);
      await expect(
        setLegacyCriterionVerdict(
          f.db,
          "actor",
          {
            projectId: "project",
            testPlanId: "plan",
            id: "criterion",
            description: "Original requirement",
            status: "MET",
          },
          { clerkActorId: "clerk" },
        ),
      ).rejects.toBeDefined();
      expect(f.tx.acceptanceCriterion.update).not.toHaveBeenCalled();
    }
  });
  it("new verdict decisions explicitly refuse reviewed or frozen planning states", async () => {
    for (const status of ["APPROVED", "ARCHIVED"]) {
      const f = fixture();
      f.state().plan.status = status;
      const input = await verdict(f);
      await expect(
        setGovernedCriterionVerdict(f.db, "actor", input, {
          clerkActorId: "clerk",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(f.state().criteria[0]!.status).toBe("AT_RISK");
    }
    for (const status of ["READY", "SHIPPED"]) {
      const f = fixture();
      f.state().plan.releaseId = "release";
      f.state().release.status = status;
      const input = await verdict(f);
      await expect(
        setGovernedCriterionVerdict(f.db, "actor", input, {
          clerkActorId: "clerk",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(f.state().criteria[0]!.status).toBe("AT_RISK");
    }
  });
  it("description-only edit preserves raw status/requirement/plan JSON and captures complete linked version snapshots", async () => {
    const f = fixture(),
      input = await f.edit();
    const ack = await editGovernedCriterionDescription(f.db, "actor", input, {
      clerkActorId: "clerk",
    });
    expect(f.state().criteria[0]).toMatchObject({
      description: "Reviewed requirement",
      status: "AT_RISK",
      requirementId: "requirement",
    });
    expect(f.tx.acceptanceCriterion.update).toHaveBeenCalledWith({
      where: { id: "criterion" },
      data: { description: "Reviewed requirement" },
    });
    const receipt = validatedGovernanceReceipt(
      [...f.state().audits.values()][0]!.metadata,
    );
    expect(validatedGovernanceReceipt(receipt)).toMatchObject({
      before: { criteria: [{ description: "Original requirement" }] },
      after: {
        customFields: { unknown: ["preserve"] },
        strategyId: "strategy",
        criteria: [{ description: "Reviewed requirement" }],
      },
    });
    expect(ack.versionNumber).toBe(2);
  });
  it("replays before stale CAS without another write or snapshot and refuses changed UUID intent", async () => {
    const f = fixture(),
      input = await f.edit();
    const first = await editGovernedCriterionDescription(f.db, "actor", input, {
      clerkActorId: "clerk",
    });
    const retry = await editGovernedCriterionDescription(f.db, "actor", input, {
      clerkActorId: "clerk",
    });
    expect(retry).toEqual({ ...first, replayed: true });
    expect(f.tx.acceptanceCriterion.update).toHaveBeenCalledTimes(1);
    expect(f.tx.testPlanVersion.create).toHaveBeenCalledTimes(1);
    await expect(
      editGovernedCriterionDescription(
        f.db,
        "actor",
        { ...input, description: "Changed intent" },
        { clerkActorId: "clerk" },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("checks current readonly/revoked/suspended/changed actors before any receipt body", async () => {
    for (const change of [
      { role: "VIEWER" },
      { seatType: "READ_ONLY" },
      { suspendedAt: new Date() },
      { clerkActorId: "other" },
    ]) {
      const f = fixture(),
        input = await f.edit();
      await editGovernedCriterionDescription(f.db, "actor", input, {
        clerkActorId: "clerk",
      });
      f.calls.length = 0;
      Object.assign(f.state(), change);
      await expect(
        editGovernedCriterionDescription(f.db, "actor", input, {
          clerkActorId: "clerk",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(f.calls.some((call) => call.includes('FROM "AuditLog"'))).toBe(
        false,
      );
    }
  });
  it("rejects wrong original organization, stale native criterion and stale assignment without partial writes", async () => {
    const f = fixture(),
      input = await f.edit();
    await expect(
      editGovernedCriterionDescription(
        f.db,
        "actor",
        { ...input, originalOrganizationId: "foreign" },
        { clerkActorId: "clerk" },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.state().criteria[0]!.status = "MET";
    await expect(
      editGovernedCriterionDescription(f.db, "actor", input, {
        clerkActorId: "clerk",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const baseline = await f.preview();
    f.state().plan.releaseId = "another";
    await expect(
      attachGovernedUnassignedPlan(
        f.db,
        "actor",
        {
          ...f.scope,
          expectedPlanRevision: baseline.planRevision,
          requestId: input.requestId,
          expectedReleaseId: null,
          releaseId: "release",
          reason: "Assign synthetic plan",
          confirmed: true,
        },
        { clerkActorId: "clerk" },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.state().audits.size).toBe(0);
  });
  it("attaches only an unassigned same-project planning release and preserves its criteria", async () => {
    const f = fixture(),
      baseline = await f.preview(),
      input = await f.edit();
    const ack = await attachGovernedUnassignedPlan(
      f.db,
      "actor",
      {
        ...f.scope,
        expectedPlanRevision: baseline.planRevision,
        requestId: input.requestId,
        expectedReleaseId: null,
        releaseId: "release",
        reason: "Assign synthetic plan",
        confirmed: true,
      },
      { clerkActorId: "clerk" },
    );
    expect(ack.releaseId).toBe("release");
    expect(f.state().criteria[0]!.description).toBe("Original requirement");
    const g = fixture(),
      foreign = await g.edit();
    g.state().release.projectId = "foreign";
    await expect(
      attachGovernedUnassignedPlan(
        g.db,
        "actor",
        {
          ...g.scope,
          expectedPlanRevision: foreign.expectedPlanRevision,
          requestId: foreign.requestId,
          expectedReleaseId: null,
          releaseId: "release",
          reason: "Assign",
          confirmed: true,
        },
        { clerkActorId: "clerk" },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(g.state().plan.releaseId).toBeNull();
  });
  it("retains approved/archived plans and READY/SHIPPED release states without silently invalidating approval", async () => {
    for (const status of ["APPROVED", "ARCHIVED"]) {
      const f = fixture(),
        input = await f.edit();
      f.state().plan.status = status;
      await expect(
        editGovernedCriterionDescription(f.db, "actor", input, {
          clerkActorId: "clerk",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(f.state().plan.status).toBe(status);
    }
    for (const status of ["READY", "SHIPPED"]) {
      const f = fixture(),
        input = await f.edit();
      f.state().release.status = status;
      await expect(
        attachGovernedUnassignedPlan(
          f.db,
          "actor",
          {
            ...f.scope,
            expectedPlanRevision: input.expectedPlanRevision,
            requestId: input.requestId,
            expectedReleaseId: null,
            releaseId: "release",
            reason: "Assign",
            confirmed: true,
          },
          { clerkActorId: "clerk" },
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(f.state().plan.releaseId).toBeNull();
    }
  });
  it("bounds native payload before materialization and rolls back complete changes on native receipt expansion", async () => {
    const f = fixture(),
      input = await f.edit();
    f.state().nativePlanBytes = BigInt(MAX_GOVERNANCE_SNAPSHOT_BYTES + 1);
    const reads = f.tx.testPlan.findFirstOrThrow.mock.calls.length;
    await expect(
      editGovernedCriterionDescription(f.db, "actor", input, {
        clerkActorId: "clerk",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(f.tx.testPlan.findFirstOrThrow.mock.calls).toHaveLength(reads);
    const g = fixture(),
      next = await g.edit();
    g.state().nativeAuditBytes = MAX_GOVERNANCE_RECEIPT_BYTES + 1;
    await expect(
      editGovernedCriterionDescription(g.db, "actor", next, {
        clerkActorId: "clerk",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(g.state().criteria[0]!.description).toBe("Original requirement");
    expect(g.state().audits.size).toBe(0);
    expect(g.state().versions).toHaveLength(1);
  });
  it("a receipt cannot silently alter unrelated associations or raw verdicts", async () => {
    const f = fixture(),
      input = await f.edit();
    await editGovernedCriterionDescription(f.db, "actor", input, {
      clerkActorId: "clerk",
    });
    const saved = validatedGovernanceReceipt(
      structuredClone([...f.state().audits.values()][0]!.metadata),
    );
    saved.after.criteria[0]!.status = "MET";
    saved.ack.afterRevision = governanceRequestHash(saved.after);
    expect(() => validatedGovernanceReceipt(saved)).toThrow(
      "complete scoped snapshot",
    );
  });
  it("conservatively bounds cumulative history while still acknowledging exact earlier writes", async () => {
    const f = fixture(),
      input = await f.edit();
    const ack = await editGovernedCriterionDescription(f.db, "actor", input, {
      clerkActorId: "clerk",
    });
    f.state().historyCount = MAX_GOVERNANCE_HISTORY_REVISIONS;
    expect(
      await editGovernedCriterionDescription(f.db, "actor", input, {
        clerkActorId: "clerk",
      }),
    ).toEqual({ ...ack, replayed: true });
    const next = await f.edit();
    await expect(
      editGovernedCriterionDescription(
        f.db,
        "actor",
        { ...next, requestId: "6bd36763-03c7-4d73-81a1-4114a7332b1a" },
        { clerkActorId: "clerk" },
      ),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(f.state().versions).toHaveLength(2);
  });
  it("lets current viewers read complete scoped history but bounds metadata and refuses another original tenant", async () => {
    const f = fixture(),
      input = await f.edit();
    await editGovernedCriterionDescription(f.db, "actor", input, {
      clerkActorId: "clerk",
    });
    f.state().role = "VIEWER";
    f.state().seatType = "READ_ONLY";
    const history = await listPlanGovernanceHistory(
      f.db,
      "actor",
      { ...f.scope, take: 5 },
      { clerkActorId: "clerk" },
    );
    expect(history.entries[0]?.receipt.before.criteria[0]?.description).toBe(
      "Original requirement",
    );
    await expect(
      listPlanGovernanceHistory(
        f.db,
        "actor",
        { ...f.scope, originalOrganizationId: "foreign", take: 5 },
        { clerkActorId: "clerk" },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.state().nativeAuditBytes = MAX_GOVERNANCE_RECEIPT_BYTES + 1;
    await expect(
      listPlanGovernanceHistory(
        f.db,
        "actor",
        { ...f.scope, take: 5 },
        { clerkActorId: "clerk" },
      ),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it("exposes explicit reopened-state instructions and refuses to truncate oversized unknown JSON", async () => {
    const f = fixture();
    f.state().plan.status = "APPROVED";
    expect(await f.preview()).toMatchObject({
      canEdit: false,
      editBlockedReason: expect.stringMatching(/Reopen/),
    });
    const current = (await f.preview()).snapshot;
    expect(() =>
      boundedGovernanceSnapshot({
        ...current,
        customFields: { preserved: "x".repeat(MAX_GOVERNANCE_SNAPSHOT_BYTES) },
      }),
    ).toThrow("No criteria");
    expect(() =>
      boundedGovernanceSnapshot({
        ...current,
        criteria: Array.from({ length: 201 }, () => current.criteria[0]),
      }),
    ).toThrow("No criteria");
  });
  it("new status/metadata schemas reject mixed header/whole-record/defaulted intents without altering old request hashes", async () => {
    const f = fixture(),
      p = await f.preview(),
      common = {
        ...f.scope,
        expectedPlanRevision: p.planRevision,
        requestId: crypto.randomUUID(),
        reason: "Reviewed native status",
        confirmed: true as const,
      };
    const status = {
      ...common,
      expectedStatus: "DRAFT" as const,
      status: "ACTIVE" as const,
      intent: "CHANGE" as const,
    };
    expect(setPlanStatusInput.parse(status)).toEqual(status);
    for (const patch of [
      { name: "resend" },
      { customFields: {} },
      { expectedStatus: "APPROVED" },
      { status: "DRAFT" },
      { intent: "REOPEN" },
    ])
      expect(
        setPlanStatusInput.safeParse({ ...status, ...patch }).success,
      ).toBe(false);
    const metadata = {
      ...common,
      expectedFieldSchemaHash: p.metadataSchema.fieldSchemaHash!,
      changes: [
        { operation: "SET" as const, key: "objective", value: " raw\n " },
      ],
    };
    expect(editPlanCustomFieldsInput.parse(metadata)).toEqual(metadata);
    for (const patch of [
      { name: "old header" },
      { status: "APPROVED" },
      { customFields: {} },
      { expectedFieldSchemaHash: undefined },
    ])
      expect(
        editPlanCustomFieldsInput.safeParse({ ...metadata, ...patch }).success,
      ).toBe(false);
    const old = await f.edit();
    expect(editCriterionDescriptionInput.parse(old)).toEqual(old);
    expect(
      governanceRequestHash({
        operation: "EDIT_CRITERION_DESCRIPTION",
        input: old,
      }),
    ).toBe(
      governanceRequestHash({
        operation: "EDIT_CRITERION_DESCRIPTION",
        input: editCriterionDescriptionInput.parse(old),
      }),
    );
  });
  it("preview exposes independent recovery/status/schema capabilities and optional new read activation identity only when supplied", async () => {
    const f = fixture(),
      old = await f.preview();
    expect(old).not.toHaveProperty("requestId");
    expect(old.canRecover).toBe(true);
    expect(old.statusActions.canChange).toBe(true);
    expect(old.metadataSchema.canEdit).toBe(true);
    const requestId = crypto.randomUUID();
    expect(
      await previewPlanGovernance(
        f.db,
        "actor",
        { ...f.scope, requestId },
        { clerkActorId: "clerk" },
      ),
    ).toMatchObject({ requestId, planRevision: old.planRevision });
    f.state().plan.status = "APPROVED";
    expect(await f.preview()).toMatchObject({
      canRecover: true,
      canEdit: false,
      statusActions: { canChange: false, canReopen: true },
      metadataSchema: { canEdit: false },
    });
    f.state().plan.releaseId = "release";
    f.state().release.status = "SHIPPED";
    expect(await f.preview()).toMatchObject({
      canRecover: true,
      statusActions: {
        canChange: false,
        canReopen: false,
        blockedReason: expect.stringMatching(/Reopen/),
      },
    });
    f.state().seatType = "READ_ONLY";
    expect(await f.preview()).toMatchObject({ canRecover: false });
  });
  it("new status changes preserve all raw metadata/criteria/header/configuration and get one scoped full audit/version", async () => {
    const f = fixture();
    f.state().plan.customFields = null;
    f.state().plan.executionTemplate = [" raw ", null, false];
    const p = await f.preview(),
      original = p.snapshot;
    const input = {
      ...f.scope,
      expectedPlanRevision: p.planRevision,
      requestId: crypto.randomUUID(),
      reason: "Synthetic lifecycle review",
      confirmed: true as const,
      expectedStatus: "DRAFT" as const,
      status: "APPROVED" as const,
      intent: "CHANGE" as const,
    };
    const ack = await setGovernedPlanStatus(f.db, "actor", input, {
      clerkActorId: "clerk",
    });
    expect(ack).toMatchObject({
      operation: "SET_PLAN_STATUS",
      criterionId: null,
    });
    const after = (await f.preview()).snapshot;
    expect(after).toMatchObject({
      name: original.name,
      description: original.description,
      customFields: null,
      executionTemplate: original.executionTemplate,
      criteria: original.criteria,
      releaseId: original.releaseId,
      strategyId: original.strategyId,
      status: "APPROVED",
    });
    expect(f.tx.testPlan.update.mock.calls.at(-1)![0].data).toEqual({
      status: "APPROVED",
      updatedById: "actor",
    });
    expect(
      validatedGovernanceReceipt([...f.state().audits.values()][0]!.metadata)
        .after.status,
    ).toBe("APPROVED");
    expect(
      await setGovernedPlanStatus(f.db, "actor", input, {
        clerkActorId: "clerk",
      }),
    ).toEqual({ ...ack, replayed: true });
    expect(f.tx.testPlan.update).toHaveBeenCalledTimes(1);
  });
  it("explicit REOPEN is the only frozen-plan transition, with attached READY/SHIPPED refusal and exact native CAS", async () => {
    for (const frozen of ["APPROVED", "ARCHIVED"]) {
      const f = fixture();
      f.state().plan.status = frozen;
      const p = await f.preview(),
        input = {
          ...f.scope,
          expectedPlanRevision: p.planRevision,
          requestId: crypto.randomUUID(),
          reason: "Explicit reopen",
          confirmed: true as const,
          expectedStatus: frozen as "APPROVED" | "ARCHIVED",
          status: "DRAFT" as const,
          intent: "REOPEN" as const,
        };
      await setGovernedPlanStatus(f.db, "actor", input, {
        clerkActorId: "clerk",
      });
      expect(f.state().plan.status).toBe("DRAFT");
      const wrong = fixture();
      wrong.state().plan.status = frozen;
      wrong.state().plan.releaseId = "release";
      wrong.state().release.status = "READY";
      const blocked = await wrong.preview();
      await expect(
        setGovernedPlanStatus(
          wrong.db,
          "actor",
          {
            ...input,
            expectedPlanRevision: blocked.planRevision,
            requestId: crypto.randomUUID(),
          },
          { clerkActorId: "clerk" },
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(wrong.tx.testPlan.update).not.toHaveBeenCalled();
    }
    const f = fixture(),
      p = await f.preview(),
      input = {
        ...f.scope,
        expectedPlanRevision: p.planRevision,
        requestId: crypto.randomUUID(),
        reason: "Review",
        confirmed: true as const,
        expectedStatus: "DRAFT" as const,
        status: "ACTIVE" as const,
        intent: "CHANGE" as const,
      };
    f.state().plan.name = "concurrent header";
    await expect(
      setGovernedPlanStatus(f.db, "actor", input, { clerkActorId: "clerk" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.tx.testPlan.update).not.toHaveBeenCalled();
  });
  it("new metadata SET/REMOVE writes preserve exact unknown/native siblings and record genuine raw schema+patch provenance", async () => {
    const f = fixture();
    f.state().plan.customFields = JSON.parse(
      '{"objective":"old","enabled":false,"count":0,"areas":["same","same",""],"__proto__":{"keep":true},"future":{"raw":[false,null," x "]}}',
    );
    const p = await f.preview(),
      before = p.snapshot;
    const input = {
      ...f.scope,
      expectedPlanRevision: p.planRevision,
      expectedFieldSchemaHash: p.metadataSchema.fieldSchemaHash!,
      requestId: crypto.randomUUID(),
      reason: "Reviewed raw fields",
      confirmed: true as const,
      changes: [
        {
          operation: "SET" as const,
          key: "objective",
          value: " raw\n objective ",
        },
        { operation: "REMOVE" as const, key: "enabled" },
        {
          operation: "SET" as const,
          key: "areas",
          value: ["", "same", "same", " exact\n"],
        },
      ],
    };
    const ack = await editGovernedPlanCustomFields(f.db, "actor", input, {
      clerkActorId: "clerk",
    });
    expect(ack).toMatchObject({
      operation: "EDIT_PLAN_CUSTOM_FIELDS",
      criterionId: null,
    });
    const receipt = validatedGovernanceReceipt(
      [...f.state().audits.values()][0]!.metadata,
    );
    expect(receipt.metadataReview).toEqual({
      testPlanTypeId: before.testPlanTypeId,
      fieldSchema: f.state().type.fieldSchema,
      fieldSchemaHash: input.expectedFieldSchemaHash,
      changes: input.changes,
    });
    expect(receipt.after).toMatchObject({
      name: before.name,
      status: before.status,
      criteria: before.criteria,
      executionTemplate: before.executionTemplate,
      releaseId: before.releaseId,
    });
    const after = receipt.after.customFields as Record<string, unknown>;
    expect(after.objective).toBe(" raw\n objective ");
    expect(after.areas).toEqual(["", "same", "same", " exact\n"]);
    expect(Object.hasOwn(after, "enabled")).toBe(false);
    expect(after.future).toEqual(
      (before.customFields as Record<string, unknown>).future,
    );
    expect(Object.hasOwn(after, "__proto__")).toBe(true);
    expect(
      await editGovernedPlanCustomFields(f.db, "actor", input, {
        clerkActorId: "clerk",
      }),
    ).toEqual({ ...ack, replayed: true });
    expect(f.tx.testPlan.update).toHaveBeenCalledTimes(1);
  });
  it("oversized/unsupported type schema does not trap old status/header receipts or expose fabricated metadata schema/hash", async () => {
    const f = fixture(),
      p = await f.preview(),
      status = {
        ...f.scope,
        expectedPlanRevision: p.planRevision,
        requestId: crypto.randomUUID(),
        reason: "Review",
        confirmed: true as const,
        expectedStatus: "DRAFT" as const,
        status: "ACTIVE" as const,
        intent: "CHANGE" as const,
      };
    const ack = await setGovernedPlanStatus(f.db, "actor", status, {
      clerkActorId: "clerk",
    });
    f.state().nativeTypeBytes = 32769n;
    const reads = f.tx.testPlanType.findUnique.mock.calls.length;
    expect(await f.preview()).toMatchObject({
      canRecover: true,
      metadataSchema: {
        fieldSchema: null,
        fieldSchemaHash: null,
        supported: false,
        canEdit: false,
      },
    });
    expect(f.tx.testPlanType.findUnique.mock.calls).toHaveLength(reads);
    expect(
      await setGovernedPlanStatus(f.db, "actor", status, {
        clerkActorId: "clerk",
      }),
    ).toEqual({ ...ack, replayed: true });
    expect(f.tx.testPlanType.findUnique.mock.calls).toHaveLength(reads);
    const q = await f.preview();
    await editGovernedPlanHeader(
      f.db,
      "actor",
      {
        ...f.scope,
        expectedPlanRevision: q.planRevision,
        requestId: crypto.randomUUID(),
        reason: "Header independent of unsupported metadata type",
        confirmed: true,
        name: "Updated header",
      },
      { clerkActorId: "clerk" },
    );
    expect(f.state().plan.name).toBe("Updated header");
  });
  it("refuses new status, header, criterion and metadata writes before any mutation/version when either complete native JSON column fails round-trip", async () => {
    for (const column of [
      "customFieldsExact",
      "executionTemplateExact",
    ] as const) {
      for (const operation of ["status", "header", "criterion", "metadata"]) {
        const f = fixture(),
          p = await f.preview(),
          base = {
            ...f.scope,
            expectedPlanRevision: p.planRevision,
            requestId: crypto.randomUUID(),
            reason: "Codec boundary review",
            confirmed: true as const,
          };
        f.state()[column] = false;
        const before = structuredClone(f.state().plan);
        const call =
          operation === "status"
            ? setGovernedPlanStatus(
                f.db,
                "actor",
                {
                  ...base,
                  expectedStatus: "DRAFT",
                  status: "ACTIVE",
                  intent: "CHANGE",
                },
                { clerkActorId: "clerk" },
              )
            : operation === "header"
              ? editGovernedPlanHeader(
                  f.db,
                  "actor",
                  { ...base, name: "Different" },
                  { clerkActorId: "clerk" },
                )
              : operation === "criterion"
                ? editGovernedCriterionDescription(
                    f.db,
                    "actor",
                    {
                      ...base,
                      criterionId: "criterion",
                      expectedCriterionRevision:
                        p.criterionRevisions.criterion!,
                      description: "Different",
                    },
                    { clerkActorId: "clerk" },
                  )
                : editGovernedPlanCustomFields(
                    f.db,
                    "actor",
                    {
                      ...base,
                      expectedFieldSchemaHash:
                        p.metadataSchema.fieldSchemaHash!,
                      changes: [
                        {
                          operation: "SET",
                          key: "objective",
                          value: "Different",
                        },
                      ],
                    },
                    { clerkActorId: "clerk" },
                  );
        await expect(call).rejects.toMatchObject({
          code: "PRECONDITION_FAILED",
          message: expect.stringContaining("codec"),
        });
        expect(f.state().plan).toEqual(before);
        expect(f.tx.testPlan.update).not.toHaveBeenCalled();
        expect(f.tx.acceptanceCriterion.update).not.toHaveBeenCalled();
        expect(f.state().versions).toHaveLength(1);
        expect(f.state().audits.size).toBe(0);
      }
    }
  });
  it("binds exact safely encoded complete JSON, preserving JSON null while refusing a native SQL-null mismatch", async () => {
    const f = fixture();
    f.state().plan.customFields = null;
    f.state().plan.executionTemplate = [false, 0, " raw\n", { nested: null }];
    await editGovernedPlanHeader(
      f.db,
      "actor",
      { ...(await headerInput(f)), name: "Exact JSON" },
      { clerkActorId: "clerk" },
    );
    const call = f.tx.$queryRaw.mock.calls.find(
      ([query]) =>
        Array.isArray(query) &&
        query.join("?").includes('AS "customFieldsExact"'),
    )!;
    expect(call.slice(1)).toEqual([
      "null",
      '[false,0," raw\\n",{"nested":null}]',
      "plan",
      "project",
    ]);
    expect((call[0] as string[]).join("?")).toContain(
      '"customFields" IS NOT DISTINCT FROM ?::jsonb',
    );
    const g = fixture();
    g.state().plan.customFields = null;
    g.state().customFieldsExact = false; // Native SQL NULL != encoded JSON null.
    await expect(
      editGovernedPlanHeader(
        g.db,
        "actor",
        { ...(await headerInput(g)), name: "Refused SQL null" },
        { clerkActorId: "clerk" },
      ),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(g.tx.testPlan.update).not.toHaveBeenCalled();
  });
  it("accepted exact UUID replay bypasses later codec mismatches without new writes or version captures", async () => {
    const f = fixture(),
      input = {
        ...(await headerInput(f)),
        name: "Accepted before codec change",
      };
    const ack = await editGovernedPlanHeader(f.db, "actor", input, {
      clerkActorId: "clerk",
    });
    f.state().customFieldsExact = false;
    f.state().executionTemplateExact = false;
    f.state().schemaRoundTripExact = false;
    const checks = f.calls.filter((text) =>
      text.includes('AS "customFieldsExact"'),
    ).length;
    expect(
      await editGovernedPlanHeader(f.db, "actor", input, {
        clerkActorId: "clerk",
      }),
    ).toEqual({ ...ack, replayed: true });
    expect(
      f.calls.filter((text) => text.includes('AS "customFieldsExact"')),
    ).toHaveLength(checks);
    expect(f.tx.testPlan.update).toHaveBeenCalledTimes(1);
    expect(f.state().audits.size).toBe(1);
  });
  it("withholds inexact native schema provenance/hash and refuses metadata while header/status and exact recovery remain independent", async () => {
    const f = fixture(),
      p = await f.preview();
    f.state().schemaRoundTripExact = false;
    expect(await f.preview()).toMatchObject({
      canRecover: true,
      statusActions: { canChange: true },
      metadataSchema: {
        fieldSchema: null,
        fieldSchemaHash: null,
        supported: false,
        canEdit: false,
      },
    });
    await expect(
      editGovernedPlanCustomFields(
        f.db,
        "actor",
        {
          ...f.scope,
          expectedPlanRevision: p.planRevision,
          expectedFieldSchemaHash: p.metadataSchema.fieldSchemaHash!,
          requestId: crypto.randomUUID(),
          reason: "Refuse inexact schema",
          confirmed: true,
          changes: [{ operation: "SET", key: "objective", value: "new" }],
        },
        { clerkActorId: "clerk" },
      ),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(f.tx.testPlan.update).not.toHaveBeenCalled();
    await editGovernedPlanHeader(
      f.db,
      "actor",
      { ...(await headerInput(f)), name: "Schema-independent header" },
      { clerkActorId: "clerk" },
    );
    expect(f.state().plan.name).toBe("Schema-independent header");
  });
  it("metadata new writes reject stale schema/native plan revision, frozen state, incompatible root/keys and native patch/result expansion before mutation", async () => {
    const make = async (f: ReturnType<typeof fixture>) => {
      const p = await f.preview();
      return {
        ...f.scope,
        expectedPlanRevision: p.planRevision,
        expectedFieldSchemaHash: p.metadataSchema.fieldSchemaHash!,
        requestId: crypto.randomUUID(),
        reason: "Synthetic metadata review",
        confirmed: true as const,
        changes: [
          { operation: "SET" as const, key: "objective", value: "new" },
        ],
      };
    };
    for (const changes of [
      { nativeTypeBytes: 32769n },
      { typeAvailable: false },
      { nativePatchBytes: 65537n },
      { nativeMetadataBytes: BigInt(MAX_GOVERNANCE_SNAPSHOT_BYTES + 1) },
    ]) {
      const f = fixture(),
        input = await make(f);
      Object.assign(f.state(), changes);
      await expect(
        editGovernedPlanCustomFields(f.db, "actor", input, {
          clerkActorId: "clerk",
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(f.tx.testPlan.update).not.toHaveBeenCalled();
    }
    const schema = fixture(),
      input = await make(schema);
    schema.state().type.fieldSchema = {
      type: "object",
      properties: { objective: { type: "number" } },
    };
    await expect(
      editGovernedPlanCustomFields(schema.db, "actor", input, {
        clerkActorId: "clerk",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    for (const changes of [
      { status: "APPROVED" },
      { status: "ARCHIVED" },
      { customFields: null },
      { customFields: ["retained"] },
    ]) {
      const f = fixture();
      Object.assign(f.state().plan, changes);
      const reviewed = await make(f);
      await expect(
        editGovernedPlanCustomFields(f.db, "actor", reviewed, {
          clerkActorId: "clerk",
        }),
      ).rejects.toMatchObject({
        code: ["APPROVED", "ARCHIVED"].includes(f.state().plan.status)
          ? "CONFLICT"
          : "PRECONDITION_FAILED",
      });
      expect(f.tx.testPlan.update).not.toHaveBeenCalled();
    }
  });
  it("metadata receipt replay precedes later unsupported schemas and refuses new intent under an old UUID", async () => {
    const f = fixture(),
      p = await f.preview(),
      input = {
        ...f.scope,
        expectedPlanRevision: p.planRevision,
        expectedFieldSchemaHash: p.metadataSchema.fieldSchemaHash!,
        requestId: crypto.randomUUID(),
        reason: "Review",
        confirmed: true as const,
        changes: [
          { operation: "SET" as const, key: "objective", value: "raw" },
        ],
      };
    const ack = await editGovernedPlanCustomFields(f.db, "actor", input, {
      clerkActorId: "clerk",
    });
    f.state().nativeTypeBytes = 999999n;
    f.state().type.fieldSchema = { unsupported: "future" };
    f.state().plan.status = "APPROVED";
    const reads = f.tx.testPlanType.findUnique.mock.calls.length;
    expect(
      await editGovernedPlanCustomFields(f.db, "actor", input, {
        clerkActorId: "clerk",
      }),
    ).toEqual({ ...ack, replayed: true });
    expect(f.tx.testPlanType.findUnique.mock.calls).toHaveLength(reads);
    await expect(
      editGovernedPlanCustomFields(
        f.db,
        "actor",
        {
          ...input,
          changes: [
            { operation: "SET", key: "objective", value: "replacement" },
          ],
        },
        { clerkActorId: "clerk" },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.tx.testPlan.update).toHaveBeenCalledTimes(1);
    f.state().seatType = "READ_ONLY";
    await expect(
      editGovernedPlanCustomFields(f.db, "actor", input, {
        clerkActorId: "clerk",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("native transaction serialization/deadlock rollback is a typed conflict with no automatic retry or earlier-ACK rejection claim", async () => {
    for (const cause of [
      { code: "P2034" },
      { code: "40001" },
      { code: "P2010", meta: { code: "40001" } },
      { code: "40P01" },
      { code: "P2010", meta: { code: "40P01" } },
    ]) {
      const f = fixture(),
        p = await f.preview(),
        input = {
          ...f.scope,
          expectedPlanRevision: p.planRevision,
          requestId: crypto.randomUUID(),
          reason: "Review",
          confirmed: true as const,
          expectedStatus: "DRAFT" as const,
          status: "ACTIVE" as const,
          intent: "CHANGE" as const,
        };
      f.tx.$queryRaw.mockRejectedValueOnce(cause);
      const error = await setGovernedPlanStatus(f.db, "actor", input, {
        clerkActorId: "clerk",
      }).catch((value) => value);
      expect(error.code).toBe("CONFLICT");
      expect(error.message).toContain("No automatic retry");
      expect(error.message).toContain(
        "earlier unacknowledged request may already have applied",
      );
      expect(f.tx.testPlan.update).not.toHaveBeenCalled();
      expect(f.state().audits.size).toBe(0);
    }
  });
  it("unknown completion and unrelated SQL errors retain their original uncertainty instead of being classified as rolled-back conflicts", async () => {
    // SQLSTATE 40003 is completion-unknown, not the supported serialization or
    // deadlock rollback codes: https://www.postgresql.org/docs/16/errcodes-appendix.html
    for (const cause of [
      { code: "40003" },
      { code: "P2010", meta: { code: "40003" } },
      { code: "P2010", meta: { code: "XX000", message: "40P01" } },
      { code: "P2010", meta: { code: "55P03" } },
    ]) {
      const f = fixture(), p = await f.preview();
      const input = {
        ...f.scope,
        expectedPlanRevision: p.planRevision,
        requestId: crypto.randomUUID(),
        reason: "Review",
        confirmed: true as const,
        expectedStatus: "DRAFT" as const,
        status: "ACTIVE" as const,
        intent: "CHANGE" as const,
      };
      f.tx.$queryRaw.mockRejectedValueOnce(cause);
      await expect(setGovernedPlanStatus(f.db, "actor", input, {
        clerkActorId: "clerk",
      })).rejects.toBe(cause);
      expect(f.tx.testPlan.update).not.toHaveBeenCalled();
      expect(f.state().audits.size).toBe(0);
    }
  });
  it("new receipts reject forged header/status/unknown metadata changes even when a forged after hash is recomputed", async () => {
    const f = fixture(),
      p = await f.preview(),
      input = {
        ...f.scope,
        expectedPlanRevision: p.planRevision,
        expectedFieldSchemaHash: p.metadataSchema.fieldSchemaHash!,
        requestId: crypto.randomUUID(),
        reason: "Review",
        confirmed: true as const,
        changes: [
          { operation: "SET" as const, key: "objective", value: "raw" },
        ],
      };
    await editGovernedPlanCustomFields(f.db, "actor", input, {
      clerkActorId: "clerk",
    });
    const receipt = validatedGovernanceReceipt(
      [...f.state().audits.values()][0]!.metadata,
    );
    for (const mutate of [
      (r: ReturnType<typeof validatedGovernanceReceipt>) => {
        r.after.status = "APPROVED";
      },
      (r: ReturnType<typeof validatedGovernanceReceipt>) => {
        r.after.name = "forged";
      },
      (r: ReturnType<typeof validatedGovernanceReceipt>) => {
        (r.after.customFields as Record<string, unknown>).unknown = "lost";
      },
      (r: ReturnType<typeof validatedGovernanceReceipt>) => {
        delete r.metadataReview;
      },
      (r: ReturnType<typeof validatedGovernanceReceipt>) => {
        r.metadataReview!.fieldSchemaHash = "a".repeat(64);
      },
    ]) {
      const forged = structuredClone(receipt);
      mutate(forged);
      forged.ack.afterRevision = governancePlanRevision(forged.after);
      expect(() => validatedGovernanceReceipt(forged)).toThrow();
    }
  });
});
