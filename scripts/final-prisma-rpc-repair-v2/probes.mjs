import { hash, need, equal, sorted, pinned, command, identity, begin, actualIO } from "./core.mjs";
import { elf } from "./elf.mjs";

export function installed(p, io, dir) {
  const library = pinned(io, p.sqlite.library), parsed = elf(library);
  equal(parsed.defined, sorted(p.sqlite.exports), "Actual SQLite export set differs");
  equal(parsed.sonames, ["libsqlite3.so.0"], "SQLite SONAME differs");
  equal(parsed.searchPaths, [], "Unexpected SQLite loader search path");
  const probe = Buffer.from(p.sqlite.probeBase64, "base64");
  need(hash(probe) === p.sqlite.probeSha256 && probe.length === p.sqlite.probeBytes, "External regression tool differs");
  // Diagnostic output only. Never install or copy this tool to the final image.
  const executable = dir + "/sqlite-runtime-regression";
  io.write(executable, probe, 0o555);
  const result = command(io, "functional", executable, [], dir, { LD_DEBUG: "libs,files" });
  const observed = identity(result.stdout, p, io);
  need(result.stdout.includes("COUNT_VALUES_REJECTED:400000\nSQLITE_FUNCTIONAL_OK"), "Actual functional regressions absent");
  const metadata = command(io, "package", "/usr/bin/dpkg-query", ["-W", "-f=${Status}\n${Version}\n${source:Version}\n${Architecture}\n${Depends}\n", "libsqlite3-0"], dir).stdout.trim();
  equal(metadata, `install ok installed\n${p.sqlite.packageVersion}\n${p.sqlite.packageVersion}\namd64\n${p.sqlite.depends}`, "SQLite package state differs");
  equal(command(io, "owner", "/usr/bin/dpkg-query", ["-S", p.sqlite.library.path], dir).stdout.trim(), `libsqlite3-0:amd64: ${p.sqlite.library.path}`, "SQLite package ownership differs");
  equal(command(io, "audit", "/usr/bin/dpkg", ["--audit"], dir).stdout.trim(), "", "Package audit not clean");
  return { actual: true, ...observed, librarySha256: hash(library), exportCount: parsed.defined.length, functional: true, externalDiagnosticTool: true, finalImageToolInstallation: false };
}

export function consumers(p, io) {
  const observed = [], dynamicCandidates = [], scanned = [];
  const exports = new Set(elf(pinned(io, p.sqlite.library)).defined);
  for (const row of p.nativeRows) {
    const b = pinned(io, row);
    scanned.push({ path: row.path, sha256: row.sha256, nativeKind: row.nativeKind });
    if (row.nativeKind !== "ELF") continue; // Kept in full inventory; not Linux ELF loaders.
    const x = elf(b), required = x.undefined.filter(s => s.startsWith("sqlite3_"));
    if (required.length || x.needed.includes("libsqlite3.so.0")) {
      need(required.length > 0 && x.needed.includes("libsqlite3.so.0"), "Unreviewed SQLite linkage shape");
      need(required.every(s => exports.has(s)), "Missing consumer ABI symbol");
      observed.push({ path: row.path, sha256: row.sha256, undefinedSQLiteSymbols: sorted(required) });
    }
    // Report candidates, never infer that static imports cover runtime lookup.
    // All ELF files are parsed; no filename/prefix exclusion.
    if (x.undefined.some(s => /^(dlopen|dlsym|dlvsym)(@|$)/.test(s)) || b.includes(Buffer.from("libsqlite3")))
      dynamicCandidates.push({ path: row.path, sha256: row.sha256, importedLookupSymbols: x.undefined.filter(s => /^(dlopen|dlsym|dlvsym)(@|$)/.test(s)) });
  }
  const order = rows => [...rows].sort((a, b) => a.path < b.path ? -1 : 1);
  equal(order(observed), order(p.sqlite.consumers), "Complete direct-consumer set differs");
  return { actual: true, scanned, directConsumers: observed, dynamicCandidates,
    completeDynamicLookupClosureAccepted: false, independentDynamicLookupReviewRequired: true };
}

export async function browser(p, io, dir) {
  need(p.role === "api", "Browser fixture only applies to API");
  pinned(io, p.browser.binary);
  const playwright = io.load(p.browser.module);
  const instance = await playwright.chromium.launch({ executablePath: p.browser.binary.path, headless: true, timeout: 25000,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking"] });
  let result;
  try {
    const context = await instance.newContext({ serviceWorkers: "block" });
    const network = [];
    await context.route("**/*", route => { network.push(route.request().url()); return route.abort(); });
    const page = await context.newPage();
    await page.setContent('<!doctype html><title>Native probe</title><button id="probe">initial</button><script>document.querySelector("#probe").onclick=()=>{document.querySelector("#probe").textContent="clicked"}</script>', { timeout: 10000 });
    await page.locator("#probe").click({ timeout: 10000 });
    equal(await page.locator("#probe").textContent(), "clicked", "Browser DOM interaction failed");
    equal(await page.title(), "Native probe", "Browser document failed");
    const png = await page.screenshot({ timeout: 10000 });
    need(png.length > 100 && png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), "Actual browser raster absent");
    io.write(dir + "/synthetic-browser.png", png);
    equal(network, [], "Unexpected browser request");
    result = { actual: true, domInteraction: true, rasterSha256: hash(png), version: instance.version(), browserSha256: p.browser.binary.sha256, customerPage: false };
    await context.close();
  } finally { await instance.close(); }
  return result;
}

export function validateSchemaResponse(response) {
  need(response?.id === 1 && response.jsonrpc === "2.0" && !response.error, "Schema engine RPC failed");
  need(Number.isInteger(response.result?.executedSteps) && response.result.executedSteps > 0, "Schema engine performed no schema work");
  equal(response.result.warnings, [], "Schema engine warnings");
  equal(response.result.unexecutable, [], "Schema engine unexecutable work");
  return response.result;
}

export async function schemaRpc(io, binary, schema, dir) {
  const args = ["--datamodels", dir + "/schema.prisma"];
  const request = { jsonrpc: "2.0", id: 1, method: "schemaPush", params: { force: false, schema: { files: [{ path: dir + "/schema.prisma", content: schema }] } } };
  io.write(dir + "/schema-request.json", JSON.stringify(request));
  const result = await new Promise((resolve, reject) => {
    const child = io.spawnAsync(binary, args, { cwd: dir, env: { PATH: "/usr/bin:/bin", HOME: dir, LANG: "C", RUST_LOG: "info" }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "", pending = "", response = null, error = null, shutdown = null, shutdownTimer = null;
    const timer = setTimeout(() => { error ??= "Schema engine timeout"; child.kill("SIGKILL"); }, 30000);
    child.on("error", e => { error ??= { message: e.message, code: e.code, errno: e.errno, syscall: e.syscall }; });
    child.stdin.on("error", e => { error ??= { message: e.message, code: e.code }; });
    child.stderr.on("data", b => { stderr += b; if (stderr.length > 1024 ** 2) { error ??= "Schema stderr bound"; child.kill("SIGKILL"); } });
    child.stdout.on("data", b => {
      stdout += b; pending += b;
      if (stdout.length > 1024 ** 2) { error ??= "Schema stdout bound"; child.kill("SIGKILL"); return; }
      let split;
      while ((split = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, split); pending = pending.slice(split + 1);
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line);
          if (row.method === "print" && row.id !== undefined) child.stdin.write(JSON.stringify({ id: row.id, jsonrpc: "2.0", result: {} }) + "\n");
          else {
            need(response === null && row.id === 1, "Unexpected/duplicate schema RPC response");
            response = row;
            if (row.error) {
              // The RPC server can stay alive after an error and stdin EOF.
              // Retain the response, stop this failed child now, never retry.
              error ??= "Schema engine RPC error response";
              child.kill("SIGKILL");
            } else {
              validateSchemaResponse(row);
              // Prisma 5.22 SchemaEngine.stop() uses child.kill() (SIGTERM).
              // Keep the observed signal; never pretend this is natural exit 0.
              shutdown = { requestedSignal: "SIGTERM", reason: "VALID_SCHEMA_RESPONSE" };
              shutdownTimer = setTimeout(() => { error ??= "Schema engine shutdown timeout"; child.kill("SIGKILL"); }, 2000);
              child.kill("SIGTERM");
            }
          }
        } catch (e) { error ??= e.message; child.kill("SIGKILL"); }
      }
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      clearTimeout(shutdownTimer);
      if (pending.trim()) error = error ?? "Unterminated schema RPC frame";
      const expectedShutdown = shutdown !== null && code === null && signal === "SIGTERM" && error === null;
      const record = { exe: binary, args, code, signal, error, stdout, stderr, response, shutdown, expectedShutdown };
      io.write(dir + "/schema-command.json", JSON.stringify(record));
      if (error || (!expectedShutdown && (code !== 0 || signal))) reject(Error("Schema engine child failed")); else resolve(response);
    });
    child.stdin.write(JSON.stringify(request) + "\n");
  });
  return validateSchemaResponse(result);
}

export async function prisma(p, io, dir) {
  if (p.role === "web") {
    need(p.prisma.applicable === false && p.prisma.engines.length === 0, "Web applicability changed");
    need(!p.nativeRows.some(r => /prisma|query[_-]engine|schema[_-]engine/i.test(r.path)), "Web gained a Prisma native path");
    need(p.browser === null && !p.nativeRows.some(r => /chrom(e|ium)|playwright|firefox|webkit/i.test(r.path)), "Web browser applicability changed");
    need(/^[a-f0-9]{64}$/.test(p.finalInventorySha256 ?? ""), "Final Web inventory binding required");
    for (const r of p.nativeRows) pinned(io, r);
    // This is not load/query success. Frozen generic finalNativeEvidence refuses it.
    return { actual: false, applicable: false, reason: "NO_PRISMA_ENGINE_IN_COMPLETE_REVIEWED_NATIVE_INVENTORY", verifiedNativeRows: p.nativeRows.length,
      browserApplicable: false, absenceObserved: true, fullNativeInventorySha256: p.finalInventorySha256, scanned: p.nativeRows,
      absenceScope: "Bound inventory; final full-filesystem equality gate remains mandatory", gateSuccessorRequired: true };
  }
  need(p.prisma.applicable === true, "API Prisma proof cannot be waived");
  for (const row of p.prisma.engines) pinned(io, row);
  const query = p.prisma.engines.find(r => r.path === p.prisma.queryPath), schemaEngine = p.prisma.engines.find(r => r.path === p.prisma.schemaPath);
  need(query && schemaEngine, "Exact query and schema engine required");
  const db = dir + "/synthetic.db";
  need(!io.exists(db), "Existing database refused");
  const schema = `datasource db {\n provider = "sqlite"\n url = "file:${db}"\n}\nmodel NativeProbe {\n id Int @id\n value String\n}\n`;
  io.write(dir + "/schema.prisma", schema);
  const schemaResult = await schemaRpc(io, schemaEngine.path, schema, dir);
  const module = io.load(query.path);
  need(typeof module.QueryEngine === "function", "Native query engine did not load");
  const logs = [], engine = new module.QueryEngine({ datamodel: schema, env: {}, logQueries: false, ignoreEnvVarErrors: false,
    datasourceOverrides: {}, logLevel: "error", configDir: dir, engineProtocol: "json" }, line => { need(logs.length < 100, "Query log bound"); logs.push(line); });
  let connected = false, result;
  try {
    await engine.connect("{}"); connected = true;
    const ask = async (action, arguments_) => {
      const request = { modelName: "NativeProbe", action, query: { arguments: arguments_, selection: { id: true, value: true } } };
      const raw = await engine.query(JSON.stringify(request), "{}", undefined);
      io.write(`${dir}/${action}-response.json`, raw);
      const response = JSON.parse(raw); need(!response.errors && response.data, "Native query returned errors"); return response.data;
    };
    const created = await ask("createOne", { data: { id: 73, value: "native-probe" } });
    const found = await ask("findUnique", { where: { id: 73 } });
    equal(created, { createOneNativeProbe: { id: 73, value: "native-probe" } }, "Unexpected native create response");
    equal(found, { findUniqueNativeProbe: { id: 73, value: "native-probe" } }, "Unexpected native read response");
    result = { actual: true, applicable: true, schemaSteps: schemaResult.executedSteps, queryEngineSha256: query.sha256, schemaEngineSha256: schemaEngine.sha256, actualCreateAndRead: true, syntheticDatabase: true };
  } finally {
    io.write(dir + "/query-logs.json", JSON.stringify(logs));
    if (connected) await engine.disconnect("{}");
  }
  const header = io.read(db).subarray(0, 16);
  equal(header.toString("hex"), Buffer.from("SQLite format 3\0").toString("hex"), "Synthetic Prisma DB header absent");
  return result;
}

export async function runFixture(p, io = actualIO()) {
  const dir = begin(p, io);
  let result;
  try {
    if (p.kind === "sqlite-installed") result = installed(p, io, dir);
    else if (p.kind === "sqlite-consumers") result = consumers(p, io);
    else if (p.kind === "browser") result = await browser(p, io, dir);
    else if (p.kind === "prisma") result = await prisma(p, io, dir);
    else throw Error("Unknown fixture");
    io.write(dir + "/observation.json", JSON.stringify({ ...result, source: p.source, image: p.image, role: p.role, accepted: false, runtimeAccepted: false, releaseAccepted: false }));
  } catch (e) {
    io.write(dir + "/failure.json", JSON.stringify({ message: e.message, code: e.code ?? null, errno: e.errno ?? null, syscall: e.syscall ?? null }));
    throw e;
  }
  return result;
}
