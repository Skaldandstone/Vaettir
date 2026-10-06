import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { manualRetestExpectedScopeSchema } from "./manualRetestScopeSchema.js";
import { retestPreviewInputSchema, retestStartInputSchema } from "./manualRetestInputSchema.js";
// Only inspect service exports, never construct/connect a real Prisma client.
vi.mock("@vaettir/db", () => ({ Prisma: {}, prisma: {} }));
import { retestPreviewInputSchema as servicePreview, retestStartInputSchema as serviceStart } from "./manualRetest.js";
import { retestAccessReviewedInput, retestPreviewReviewedInput, retestStartReviewedInput } from "./manualRetestReviewedSchema.js";

// Exact comment-free constructor AST and complete non-import service AST
// captured from HEAD8a420da175124e479a424db64ffa41cc9e99cfa5 BEFORE extraction.
// The oracle is test-only. Production has one authoritative schema instance.
const originalConstructors = [
  'export const retestPreviewInputSchema = z\n    .object({\n    projectId: identity,\n    sourceRunId: identity,\n    testCaseId: identity,\n    expectedScope: manualRetestExpectedScopeSchema.optional(),\n})\n    .strict();',
  'export const retestStartInputSchema = retestPreviewInputSchema.extend({\n    expectedReviewHash: z.string().regex(/^[a-f0-9]{64}$/),\n    idempotencyKey: z.string().uuid(),\n});',
];
const schemaNames = ["retestPreviewInputSchema", "retestStartInputSchema"];
const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
const load = (name:string) => ts.createSourceFile(name, readFileSync(new URL(name, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
function constructor(node:ts.Node): node is ts.VariableStatement { return ts.isVariableStatement(node) && node.declarationList.declarations.some(d => ts.isIdentifier(d.name) && schemaNames.includes(d.name.text)); }
function goldenOracle() {
  const code=ts.transpileModule('const identity=z.string().min(1).max(200);\n'+originalConstructors.join("\n").replaceAll("export ","")+"\nreturn {retestPreviewInputSchema,retestStartInputSchema};",{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  return new Function("z","manualRetestExpectedScopeSchema",code)(z,manualRetestExpectedScopeSchema) as {retestPreviewInputSchema:typeof retestPreviewInputSchema;retestStartInputSchema:typeof retestStartInputSchema};
}
const raw = () => ({ idempotencyKey:"88c47b3b-d1f7-43b5-bd88-b49ddf14b8c0",expectedReviewHash:"a".repeat(64),expectedScope:{clerkActorId:" Raw Clerk ",organizationId:" Raw org ",projectId:" Raw project "},testCaseId:" Raw case ",sourceRunId:" Raw run ",projectId:" Raw project " });
describe("browser-pure exact legacy retest input extraction; source/mock only",()=>{
  it("both constructors are exactly the original printed AST, not a copied browser validator",()=>{
    const ast=load("./manualRetestInputSchema.ts");
    expect(ast.statements.filter(constructor).map(n=>printer.printNode(ts.EmitHint.Unspecified,n,ast))).toEqual(originalConstructors);
    const identity=ast.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>ts.isIdentifier(d.name)&&d.name.text==="identity"));
    if(!identity)throw Error("Original scalar identity absent");expect(printer.printNode(ts.EmitHint.Unspecified,identity,ast)).toBe("const identity = z.string().min(1).max(200);");
  });
  it("whole service body/hash/UUID/locks/closure/MAX/local identity AST is unchanged apart from moved constructors/imports",()=>{
    const ast=load("./manualRetest.ts"),body=ast.statements.filter(n=>!ts.isImportDeclaration(n)&&!ts.isExportDeclaration(n)&&!constructor(n)).map(n=>printer.printNode(ts.EmitHint.Unspecified,n,ast)).join("\n");
    expect(createHash("sha256").update(body).digest("hex")).toBe("3aaf2fedf4819cd5bde8b68c6da8ed3d33f674430faf5dbfedf2ab620a87b371");
    expect(ast.statements.filter(constructor)).toHaveLength(0);
  });
  it("legacy public service and reviewed transport reference the same authoritative constructor instances",()=>{
    expect(servicePreview).toBe(retestPreviewInputSchema);expect(serviceStart).toBe(retestStartInputSchema);
    expect(retestAccessReviewedInput.shape.request).toBe(retestPreviewInputSchema);
    expect(retestPreviewReviewedInput.shape.request.innerType()).toBe(retestPreviewInputSchema);
    expect(retestStartReviewedInput.shape.request.innerType()).toBe(retestStartInputSchema);
  });
  it("reversed raw insertion order becomes the same parsed original field order without trimming or modifying raw input",()=>{
    const original=goldenOracle(),r=raw(),before=JSON.stringify(r),parsed=retestStartInputSchema.parse(r);
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(original.retestStartInputSchema.parse(r)));
    expect(Object.keys(parsed)).toEqual(["projectId","sourceRunId","testCaseId","expectedScope","expectedReviewHash","idempotencyKey"]);
    expect(Object.keys(parsed.expectedScope!)).toEqual(["projectId","organizationId","clerkActorId"]);
    expect(parsed.testCaseId).toBe(" Raw case ");expect(parsed.expectedScope?.clerkActorId).toBe(" Raw Clerk ");expect(JSON.stringify(r)).toBe(before);
  });
  it("omitted and explicit undefined scope preserve their distinct own-property representation, with no inferred defaults",()=>{
    const original=goldenOracle(),{expectedScope:discard,...absent}=raw();expect(discard.organizationId).toBe(" Raw org ");
    for(const r of [absent,{...absent,expectedScope:undefined}]){
      const parsed=retestStartInputSchema.parse(r),legacy=original.retestStartInputSchema.parse(r);
      expect(Object.keys(parsed)).toEqual(Object.keys(legacy));expect(Object.hasOwn(parsed,"expectedScope")).toBe(Object.hasOwn(r,"expectedScope"));expect(JSON.stringify(parsed)).toBe(JSON.stringify(legacy));
    }
  });
  it.each(["extra","array","number","nullscope","missing","identitylimit","hash","UUID"])("strict negative %s matches the original parser and never substitutes a supported shape",kind=>{
    const r:Record<string,unknown>=raw();if(kind==="extra")r.role="OWNER";if(kind==="array")r.projectId=["p"];if(kind==="number")r.sourceRunId=0;if(kind==="nullscope")r.expectedScope=null;if(kind==="missing")delete r.testCaseId;if(kind==="identitylimit")r.projectId="x".repeat(201);if(kind==="hash")r.expectedReviewHash="A".repeat(64);if(kind==="UUID")r.idempotencyKey="not-UUID";
    expect(retestStartInputSchema.safeParse(r).success).toBe(false);expect(goldenOracle().retestStartInputSchema.safeParse(r).success).toBe(false);
  });
  it("preview keeps exact omitted/present scope and strict unknown-key behavior",()=>{
    const original=goldenOracle(),r=raw(),preview={projectId:r.projectId,sourceRunId:r.sourceRunId,testCaseId:r.testCaseId};
    for(const p of [preview,{...preview,expectedScope:undefined},{...preview,expectedScope:r.expectedScope}])expect(JSON.stringify(retestPreviewInputSchema.parse(p))).toBe(JSON.stringify(original.retestPreviewInputSchema.parse(p)));
    for(const p of [{...preview,expectedReviewHash:r.expectedReviewHash},{...preview,expectedScope:{...r.expectedScope,role:"OWNER"}}])expect(retestPreviewInputSchema.safeParse(p).success).toBe(false);
  });
  it("reviewed DTO source has only pure runtime dependencies; never native services, DB constructors, crypto or fixture aliases",()=>{
    const inputs=load("./manualRetestInputSchema.ts"),reviewed=load("./manualRetestReviewedSchema.ts");
    for(const ast of [inputs,reviewed])for(const node of ast.statements.filter(ts.isImportDeclaration)){
      const path=(node.moduleSpecifier as ts.StringLiteral).text;
      expect(["zod","./manualRetestScopeSchema.js","./manualRetestInputSchema.js","./caseFieldPresentationSchema.js"]).toContain(path);
    }
    const source=readFileSync(new URL("./manualRetestReviewedSchema.ts",import.meta.url),"utf8");expect(source).not.toContain('from "./manualRetest.js"');expect(source).not.toContain("node:crypto");expect(source).not.toContain("@vaettir/db");
  });
});
