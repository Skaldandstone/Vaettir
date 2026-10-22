import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { assertIdentityAcceptancePermit, validateIdentityAcceptanceEnvironment } from "./identityAcceptancePreflight.js";

const source = readFileSync(new URL("./serverApplication.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

describe("server extraction: source derivation and synthetic startup call order, not provider acceptance", () => {
  it("keeps the acceptance executable's static imports side-effect-free and the app behind preflight", () => {
    const entry = readFileSync(new URL("./identityAcceptanceServer.ts", import.meta.url), "utf8");
    const parsed = ts.createSourceFile("identityAcceptanceServer.ts", entry, ts.ScriptTarget.Latest, true);
    const imports = parsed.statements.filter(ts.isImportDeclaration).map(node => (node.moduleSpecifier as ts.StringLiteral).text);
    expect(imports.every(path => path.startsWith("node:") || path === "./identityAcceptancePreflight.js")).toBe(true);
    expect(entry.match(/import\("\.\/serverApplication\.js"\)/g)).toHaveLength(1);
    expect(entry.indexOf("loadIdentityAcceptanceApplication(process.env")).toBeLessThan(entry.indexOf('import("./serverApplication.js")'));
    expect(entry.indexOf("assertNoGeneratedPrismaEnvironment(readFileSync")).toBeLessThan(entry.indexOf('import("./serverApplication.js")'));
    expect(entry).not.toMatch(/require\(["'](?:@vaettir|@prisma|@clerk)/);
    const gate = ts.createSourceFile("identityAcceptancePreflight.ts", readFileSync(new URL("./identityAcceptancePreflight.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
    expect(gate.statements.filter(ts.isImportDeclaration).map(node => (node.moduleSpecifier as ts.StringLiteral).text)).toEqual(["node:crypto"]);
  });
  it("reconstructs the exact bba2644 production server from the reviewed minimal edits", () => {
    let original = source;
    const edits = [
      ['import { assertIdentityAcceptancePermit, identityAcceptanceRequestAllowed, type IdentityAcceptancePermit } from "./identityAcceptancePreflight.js";\n', ""],
      ['export async function startApiServer(permit?: IdentityAcceptancePermit) {\nif (permit) assertIdentityAcceptancePermit(permit, process.env);\n', ""],
      ['if (permit) {\n  server.addHook("onRequest", async (request, reply) => {\n    if (!identityAcceptanceRequestAllowed(request.headers)) {\n      return reply.code(403).send({ error: "Identity fixture origin is not permitted." });\n    }\n  });\n}\n', ""],
      ['// Only this explicitly validated fixture narrows the development CORS defaults.\nawait server.register(cors, { origin: createCorsOriginPolicy(permit\n  ? { NODE_ENV: "production", WEB_APP_URL: "http://localhost:3208" }\n  : process.env) });', 'await server.register(cors, { origin: createCorsOriginPolicy(process.env) });'],
      ['return server\n  .listen({ port, host: permit ? "127.0.0.1" : "0.0.0.0" })', 'server\n  .listen({ port, host: "0.0.0.0" })'],
      ['if (!permit && credentialMonitor)', 'if (credentialMonitor)'],
      ['    if (!permit) {\n    startReverseEngineerJobPoller();', '    startReverseEngineerJobPoller();'],
      ['    startReadinessChangeScheduler();\n    }\n    return server;', '    startReadinessChangeScheduler();'],
    ];
    for (const [changed, prior] of edits) {
      expect(original.split(changed!).length - 1).toBe(1);
      original = original.replace(changed!, prior!);
    }
    expect(original.endsWith("});\n}\n")).toBe(true);
    original = original.slice(0, -2);
    expect(hash(original)).toBe("b51b8ce948ff11335d4ac872eb94c7c49cc0cf5eb92616aaef64cced8f98efd9");
    const entry = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
    expect(entry).toContain('import { startApiServer } from "./serverApplication.js";');
    expect(entry).toContain("await startApiServer();");
    expect(entry).not.toContain("process.env");
  });

  // Execute the real extracted startup function with recording dependencies.
  // No app module graph, database, provider, network listener or auth is loaded.
  async function recordStartup(isFixture: boolean) {
    const file = ts.createSourceFile("serverApplication.ts", source, ts.ScriptTarget.Latest, true);
    const names: string[] = [];
    for (const statement of file.statements) {
      if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause;
        if (clause?.name) names.push(clause.name.text);
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings))
          names.push(...clause.namedBindings.elements.filter(e => !e.isTypeOnly).map(e => e.name.text));
        if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) names.push(clause.namedBindings.name.text);
      } else if (ts.isFunctionDeclaration(statement) && statement.name?.text !== "startApiServer" && statement.name) names.push(statement.name.text);
    }
    const bindings: Record<string, unknown> = Object.fromEntries(names.map(name => [name, vi.fn()]));
    const app = { log: { info: vi.fn(), error: vi.fn() }, setErrorHandler: vi.fn(), addHook: vi.fn(), get: vi.fn(), register: vi.fn(async () => undefined), listen: vi.fn(async () => "synthetic-listener") };
    const env = { NODE_ENV: "development", API_PORT: "4208", WEB_APP_URL: "http://localhost:3208", CORS_ALLOWED_ORIGINS: "http://localhost:3208", DATABASE_URL: "postgresql://vaettir_identity_fixture:synthetic@127.0.0.1:54828/vaettir_identity_acceptance_20261022", CLERK_SECRET_KEY: "sk_test_syntheticOnly", CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from("synthetic.clerk.accounts.dev$").toString("base64")}` };
    const permit = isFixture ? validateIdentityAcceptanceEnvironment(env, { version: 1, reviewReference: "synthetic", applicationId: "app_synthetic", developmentInstanceId: "ins_synthetic", issuer: "https://synthetic.clerk.accounts.dev", secretKeySha256: hash(env.CLERK_SECRET_KEY), publishableKeySha256: hash(env.CLERK_PUBLISHABLE_KEY) }) : undefined;
    Object.assign(bindings, {
      Fastify: vi.fn(() => app), process: { env, exit: vi.fn() },
      credentialMonitor: { check: vi.fn() },
      setInterval: vi.fn(() => ({ unref: vi.fn() })), clearInterval: vi.fn(),
      XLSX_HTTP_BODY_BYTES: 1234, assertIdentityAcceptancePermit,
    });
    const functionSource = source.slice(source.indexOf("export async function startApiServer"))
      .replace("export async function", "async function").replaceAll("import.meta.url", '"file:///synthetic/serverApplication.js"');
    const compiled = ts.transpileModule(functionSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
    const start = new Function(...Object.keys(bindings), `${compiled}\nreturn startApiServer;`)(...Object.values(bindings));
    expect(await start(permit)).toBe(app);
    return { app, bindings, env };
  }

  it("default startup retains all five pollers, credential monitor, real context registration and wildcard bind", async () => {
    const { app, bindings, env } = await recordStartup(false);
    expect(app.listen).toHaveBeenCalledWith({ port: 4208, host: "0.0.0.0" });
    for (const name of ["startReverseEngineerJobPoller", "startCaseAnalysisQueuePoller", "startReadinessDigestScheduler", "startAiCreditGrantScheduler", "startReadinessChangeScheduler"])
      expect(bindings[name]).toHaveBeenCalledTimes(1);
    expect((bindings.credentialMonitor as { check: unknown }).check).toHaveBeenCalledTimes(1);
    expect(bindings.setInterval).toHaveBeenCalledTimes(1);
    expect(bindings.createCorsOriginPolicy).toHaveBeenCalledWith(env);
    expect(bindings.registerWorkspaceIngress).toHaveBeenCalledWith(app, bindings.prisma);
    expect(app.register).toHaveBeenCalledWith(bindings.fastifyTRPCPlugin, expect.objectContaining({ trpcOptions: expect.objectContaining({ router: bindings.appRouter, createContext: bindings.createContext }) }));
  });
  it("explicit validated fixture binds loopback and skips every background starter without replacing context", async () => {
    const { app, bindings } = await recordStartup(true);
    expect(app.listen).toHaveBeenCalledWith({ port: 4208, host: "127.0.0.1" });
    for (const name of ["startReverseEngineerJobPoller", "startCaseAnalysisQueuePoller", "startReadinessDigestScheduler", "startAiCreditGrantScheduler", "startReadinessChangeScheduler", "setInterval"])
      expect(bindings[name]).not.toHaveBeenCalled();
    expect((bindings.credentialMonitor as { check: unknown }).check).not.toHaveBeenCalled();
    expect(bindings.createCorsOriginPolicy).toHaveBeenCalledWith({ NODE_ENV: "production", WEB_APP_URL: "http://localhost:3208" });
    expect(bindings.registerWorkspaceIngress).toHaveBeenCalledWith(app, bindings.prisma);
    expect(app.register).toHaveBeenCalledWith(bindings.fastifyTRPCPlugin, expect.objectContaining({ trpcOptions: expect.objectContaining({ createContext: bindings.createContext }) }));
  });
});
