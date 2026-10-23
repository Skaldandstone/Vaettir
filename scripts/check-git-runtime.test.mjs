import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { checkGitRuntime, gitChildEnvironment } from "./check-git-runtime.mjs";

const ref = "2".repeat(40);
function fixture({
  untrusted = { code: 128, stderr: "server certificate verification failed" },
  trusted = { code: 0, stdout: `${ref}\trefs/heads/main\n` },
  setupFailure = false,
} = {}) {
  const calls = [];
  let home;
  let closed = false;
  const runImpl = async (command, args, options) => {
    calls.push({ command, args, options });
    home = options.env.HOME;
    assert.equal(options.timeout, 10_000);
    assert.equal(options.maxBuffer, 16_384);
    assert.equal(options.env.DATABASE_URL, undefined);
    assert.equal(options.env.GIT_SSL_NO_VERIFY, undefined);
    if (setupFailure) return { code: 1 };
    if (command === "openssl") {
      await writeFile(join(home, "key.pem"), "fixture-key");
      await writeFile(join(home, "cert.pem"), "fixture-certificate");
    }
    if (args.includes("init")) {
      await mkdir(join(home, "fixture.git", "info"), { recursive: true });
      await writeFile(
        join(home, "fixture.git", "HEAD"),
        "ref: refs/heads/main\n",
      );
    }
    if (args.includes("update-server-info"))
      await writeFile(
        join(home, "fixture.git", "info", "refs"),
        `${ref}\trefs/heads/main\n`,
      );
    if (args.includes("ls-remote"))
      return args.some((x) => x.startsWith("http.sslCAInfo="))
        ? trusted
        : untrusted;
    return {
      code: 0,
      stdout: args.includes("hash-object")
        ? "1".repeat(40)
        : args.includes("commit-tree")
          ? ref
          : "",
    };
  };
  const createServerImpl = (tls, handler) => {
    assert.equal(tls.key.toString(), "fixture-key");
    const server = {
      once: () => {},
      listen: (port, host, callback) => {
        assert.equal(port, 0);
        assert.equal(host, "127.0.0.1");
        const response = {
          writeHead: (status) => {
            server.responseStatus = status;
          },
          end: () => {},
        };
        handler({ method: "GET", url: "/../secret" }, response);
        assert.equal(server.responseStatus, 404);
        handler({ method: "POST", url: "/fixture/HEAD" }, response);
        assert.equal(server.responseStatus, 404);
        handler(
          { method: "GET", url: "/fixture/info/refs?service=git-upload-pack" },
          response,
        );
        assert.equal(server.responseStatus, 200);
        callback();
      },
      address: () => ({ port: 12345 }),
      closeAllConnections: () => {},
      close: (callback) => {
        closed = true;
        callback();
      },
    };
    return server;
  };
  return {
    runImpl,
    createServerImpl,
    calls,
    home: () => home,
    closed: () => closed,
  };
}

test("Git child config cannot inherit provider credentials or TLS bypass", () => {
  const env = gitChildEnvironment(
    {
      PATH: "/usr/bin",
      DATABASE_URL: "secret",
      GITLAB_TOKEN: "secret",
      GIT_SSL_NO_VERIFY: "1",
      HTTPS_PROXY: "https://credential.invalid",
    },
    "/fixture",
  );
  assert.deepEqual(
    Object.keys(env).sort(),
    [
      "PATH",
      "HOME",
      "LANG",
      "LC_ALL",
      "GIT_CONFIG_NOSYSTEM",
      "GIT_CONFIG_GLOBAL",
      "GIT_TERMINAL_PROMPT",
      "GIT_ASKPASS",
      "GIT_AUTHOR_DATE",
      "GIT_COMMITTER_DATE",
    ].sort(),
  );
  assert.equal(env.GIT_CONFIG_GLOBAL, "/dev/null");
  assert.equal(env.GIT_CONFIG_NOSYSTEM, "1");
});

test("Git verifies rejected untrusted TLS then exact CA-validated synthetic ref and removes fixture", async () => {
  const f = fixture();
  assert.equal(
    await checkGitRuntime({
      ...f,
      env: { PATH: "/usr/bin", DATABASE_URL: "secret" },
    }),
    "isolated Git HTTPS certificate/ref verification",
  );
  const probes = f.calls.filter((x) => x.args.includes("ls-remote"));
  assert.equal(probes.length, 2);
  for (const probe of probes) {
    assert.ok(probe.args.includes("http.sslVerify=true"));
    assert.ok(probe.args.includes("https://127.0.0.1:12345/fixture"));
  }
  assert.ok(
    probes[1].args.some(
      (x) => x === `http.sslCAInfo=${join(f.home(), "cert.pem")}`,
    ),
  );
  assert.equal(f.closed(), true);
  await assert.rejects(access(f.home()), { code: "ENOENT" });
});

test("TLS bypass, incorrect refs, native setup errors and cancellation fail closed with cleanup", async () => {
  for (const options of [
    { untrusted: { code: 0, stdout: ref } },
    { untrusted: { code: 128, stderr: "unrelated error" } },
    { trusted: { code: 0, stdout: `${"3".repeat(40)}\trefs/heads/main` } },
    { setupFailure: true },
  ]) {
    const f = fixture(options);
    await assert.rejects(
      checkGitRuntime(f),
      /fixture setup failed|reject the untrusted|validated ref check failed/,
    );
    await assert.rejects(access(f.home()), { code: "ENOENT" });
  }
  const controller = new AbortController();
  controller.abort();
  const f = fixture();
  await assert.rejects(checkGitRuntime({ ...f, signal: controller.signal }), {
    name: "AbortError",
  });
  assert.equal(f.calls.length, 0);
});

test("Git fixture contains no external URLs, TLS bypass or imported code execution", () => {
  const source = readFileSync(
    new URL("./check-git-runtime.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /sslVerify=false|GIT_SSL_NO_VERIFY|https:\/\/(?!127\.0\.0\.1)/,
  );
  assert.match(source, /credential.helper=/);
  assert.match(source, /server.closeAllConnections\(\)/);
  assert.match(source, /basename\(root\).startsWith\("vaettir-git-runtime-"\)/);
});
