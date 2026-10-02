import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:https";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { pathToFileURL } from "node:url";

const execute = promisify(execFile);

export function gitChildEnvironment(env, home) {
  return {
    ...(typeof env.PATH === "string" ? { PATH: env.PATH } : {}),
    HOME: home,
    LANG: "C",
    LC_ALL: "C",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "/bin/false",
    GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
  };
}

async function run(command, args, options) {
  try {
    const result = await execute(command, args, options);
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    if (error.killed || error.name === "AbortError")
      throw new Error("Git runtime check cancelled or timed out");
    return {
      code: error.code,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? "",
    };
  }
}

export async function checkGitRuntime({
  env = process.env,
  signal,
  runImpl = run,
  createServerImpl = createServer,
} = {}) {
  signal?.throwIfAborted();
  const root = await mkdtemp(join(tmpdir(), "vaettir-git-runtime-"));
  const repo = join(root, "fixture.git");
  const options = {
    env: gitChildEnvironment(env, root),
    timeout: 10_000,
    maxBuffer: 16_384,
    signal,
  };
  let server;
  const checked = async (command, args) => {
    const result = await runImpl(command, args, options);
    if (result.code !== 0) throw new Error("Git runtime fixture setup failed");
    return result.stdout.trim();
  };
  try {
    await checked("openssl", [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-sha256",
      "-days",
      "1",
      "-nodes",
      "-subj",
      "/CN=Vaettir synthetic runtime",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
      "-keyout",
      join(root, "key.pem"),
      "-out",
      join(root, "cert.pem"),
    ]);
    await checked("git", ["init", "--bare", "--initial-branch=main", repo]);
    // The well-known Git empty tree is created in this disposable repository.
    const emptyTree = join(root, "empty-tree");
    await writeFile(emptyTree, Buffer.alloc(0));
    const tree = await checked("git", [
      "-C",
      repo,
      "hash-object",
      "-t",
      "tree",
      "-w",
      emptyTree,
    ]);
    if (!/^[a-f0-9]{40}$/.test(tree))
      throw new Error("Invalid synthetic tree identity");
    const ref = await checked("git", [
      "-C",
      repo,
      "-c",
      "user.name=Runtime fixture",
      "-c",
      "user.email=runtime@example.invalid",
      "commit-tree",
      tree,
      "-m",
      "Synthetic runtime fixture",
    ]);
    if (!/^[a-f0-9]{40}$/.test(ref))
      throw new Error("Invalid synthetic ref identity");
    await checked("git", ["-C", repo, "update-ref", "refs/heads/main", ref]);
    await checked("git", ["-C", repo, "update-server-info"]);
    const cert = await readFile(join(root, "cert.pem"));
    const key = await readFile(join(root, "key.pem"));
    const refs = await readFile(join(repo, "info", "refs"));
    const head = await readFile(join(repo, "HEAD"));
    if (refs.length > 1024 || head.length > 1024)
      throw new Error("Synthetic ref bound exceeded");
    server = createServerImpl({ cert, key }, (request, response) => {
      const path = request.url?.split("?")[0];
      if (
        request.method !== "GET" ||
        !["/fixture/info/refs", "/fixture/HEAD"].includes(path)
      ) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, {
        "Content-Type": "text/plain",
        "Cache-Control": "no-store",
      });
      response.end(path.endsWith("HEAD") ? head : refs);
    });
    server.maxConnections = 4;
    server.requestTimeout = 5000;
    server.headersTimeout = 5000;
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(
        () => reject(new Error("Git fixture listen timed out")),
        5000,
      );
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        clearTimeout(deadline);
        resolve();
      });
    });
    const port = server.address().port;
    const url = `https://127.0.0.1:${port}/fixture`;
    const args = [
      "-c",
      "credential.helper=",
      "-c",
      "http.sslVerify=true",
      "ls-remote",
      url,
      "refs/heads/main",
    ];
    const untrusted = await runImpl("git", args, options);
    if (
      untrusted.code === 0 ||
      !/certificate|SSL peer|verification failed/i.test(untrusted.stderr)
    )
      throw new Error("Git failed to reject the untrusted fixture certificate");
    const trusted = await runImpl(
      "git",
      ["-c", `http.sslCAInfo=${join(root, "cert.pem")}`, ...args],
      options,
    );
    if (
      trusted.code !== 0 ||
      trusted.stdout.trim() !== `${ref}\trefs/heads/main`
    )
      throw new Error("Git HTTPS validated ref check failed");
    return "isolated Git HTTPS certificate/ref verification";
  } finally {
    try {
      if (server) {
        server.closeAllConnections();
        await new Promise((resolve, reject) => {
          const deadline = setTimeout(
            () => reject(new Error("Git fixture cleanup timed out")),
            2000,
          );
          server.close(() => {
            clearTimeout(deadline);
            resolve();
          });
        });
      }
    } finally {
      if (
        dirname(root) !== tmpdir() ||
        !basename(root).startsWith("vaettir-git-runtime-")
      )
        throw new Error("Invalid fixture cleanup path");
      await rm(root, { recursive: true, force: true });
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  const deadline = setTimeout(() => process.exit(1), 70_000);
  try {
    console.log(
      `Git runtime verified: ${await checkGitRuntime({ signal: controller.signal })}`,
    );
  } catch {
    console.error(
      "Git runtime verification failed; only a disposable loopback fixture was used.",
    );
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
  if (process.exitCode) process.exit(process.exitCode);
}
