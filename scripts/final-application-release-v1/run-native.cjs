// Executes only in the derived, network-disabled diagnostic image. Its scratch
// evidence target is never the final runtime image. Failure evidence is retained.
// The pinned diagnostic entrypoint is CommonJS inside the image.
/* eslint-disable @typescript-eslint/no-require-imports -- Pinned CommonJS image entrypoint. */
const fs = require("node:fs"),
  crypto = require("node:crypto"),
  cp = require("node:child_process");
const hash = (b) => crypto.createHash("sha256").update(b).digest("hex");
const ok = (v, m) => {
  if (!v) throw Error(m);
};
const root = "/run/vaettir-native",
  raw = fs.readFileSync(root + "/native-plan.json");
ok(
  hash(raw) === process.argv[2] && process.platform === "linux",
  "Wrong native probe input",
);
const plan = JSON.parse(raw),
  out = plan.output;
ok(out === "/vaettir-sqlite-observation-v1", "Wrong evidence path");
fs.mkdirSync(out, { recursive: false, mode: 0o700 });
const save = (n, v) =>
  fs.writeFileSync(
    out + "/" + n,
    Buffer.isBuffer(v) ? v : JSON.stringify(v, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
save("intent.json", {
  source: plan.source,
  image: plan.image,
  once: true,
  releaseAccepted: false,
});
const results = [];
let error = null;
function run(name, argv, timeout, env) {
  const p = cp.spawnSync(argv[0], argv.slice(1), {
    cwd: "/app",
    env,
    timeout,
    maxBuffer: 16 * 1024 ** 2,
  });
  const result = {
    name,
    argv,
    status: p.status,
    signal: p.signal,
    error: p.error
      ? {
          code: p.error.code ?? null,
          errno: p.error.errno ?? null,
          syscall: p.error.syscall ?? null,
          message: p.error.message,
        }
      : null,
  };
  save(name + "-stdout.log", p.stdout ?? Buffer.alloc(0));
  save(name + "-stderr.log", p.stderr ?? Buffer.alloc(0));
  result.stdoutSha256 = hash(p.stdout ?? Buffer.alloc(0));
  result.stderrSha256 = hash(p.stderr ?? Buffer.alloc(0));
  save(name + "-result.json", result);
  results.push(result);
  ok(p.status === 0 && !p.signal && !p.error, "Native child failed: " + name);
}
try {
  const env = {
    PATH: "/usr/local/bin:/usr/bin:/bin",
    HOME: "/tmp",
    LANG: "C.UTF-8",
    NODE_ENV: "production",
  };
  for (const c of plan.checks) {
    const bytes = fs.readFileSync(root + "/" + c.name + ".mjs");
    ok(
      hash(bytes) === c.script.sha256 && bytes.length === c.script.bytes,
      "Native fixture changed",
    );
    run(c.name, c.argv, 120000, env);
  }
  if (plan.nss) {
    ok(
      hash(fs.readFileSync(root + "/certutil")) === plan.nss.toolSha256 &&
        hash(fs.readFileSync(root + "/nss-fixture.cjs")) ===
          plan.nss.fixtureSha256,
      "NSS tool/fixture changed",
    );
    // The reviewed144 fixture has exact fixed paths. Bind its expected /run path
    // through the diagnostic recipe, never substitute an unreviewed fixture.
    run(
      "nss",
      ["/usr/local/bin/node", root + "/nss-fixture.cjs", out],
      120000,
      env,
    );
  }
} catch (e) {
  error = {
    message: e.message,
    code: e.code ?? null,
    errno: e.errno ?? null,
    syscall: e.syscall ?? null,
  };
}
save("native-observation.json", {
  source: plan.source,
  image: plan.image,
  role: plan.role,
  results,
  error,
  allCommandsPassed: error === null,
  releaseAccepted: false,
});
// Preserve failed evidence in the scratch output. A build exit0 is never proof.
