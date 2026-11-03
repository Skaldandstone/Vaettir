// Offline preparation of a real final-source application build, Main only.
// Uses an independently admitted existing toolchain/cache image, not new infra.
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  sha,
  requireThat as ok,
  relative,
  jsonRef,
  verifyRef,
  completeInventoryRef,
} from "../production-native-successor-v1/contracts.mjs";
import { sourceAdmission, completeImage, accepted } from "./admission.mjs";
import { here, actualIo, encode } from "./context.mjs";
export function validateToolchainFiles(inventory, cache) {
  ok(
    Array.isArray(inventory) &&
      inventory.length > 0 &&
      Array.isArray(cache) &&
      cache.length > 0,
    "Empty toolchain inventory",
  );
  ok(
    !inventory.some(
      (r) =>
        r.path === "/vaettir-final-build" ||
        r.path.startsWith("/vaettir-final-build/"),
    ),
    "Build workspace must actually be absent",
  );
  const byPath = new Map(inventory.map((r) => [r.path, r]));
  ok(
    byPath.size === inventory.length &&
      new Set(cache.map((r) => r.path)).size === cache.length,
    "Duplicate toolchain/cache path",
  );
  for (const row of cache)
    ok(
      row.path.startsWith("/") &&
        JSON.stringify(byPath.get(row.path)) === JSON.stringify(row),
      "Offline cache differs from complete image inventory",
    );
}
export function builderRecipe(
  role,
  builder,
  parentWeb,
  source,
  executables = [],
) {
  ok(
    ["api", "web"].includes(role) && /^[a-f0-9]{40}$/.test(source),
    "Invalid application build",
  );
  const publicArgs = [
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_API_URL",
    "NEXT_PUBLIC_VAETTIR_WORKSPACE_AUTH_ENABLED",
    "NEXT_PUBLIC_VAETTIR_PRIMARY_AUTH_ENABLED",
    "NEXT_PUBLIC_VAETTIR_ACTIVE_WORKSPACE_NAMES",
    "NEXT_PUBLIC_SENTRY_DSN",
  ];
  const args =
    role === "web"
      ? publicArgs.map((x) => `ARG ${x}\nENV ${x}=$${x}`).join("\n") +
        "\nENV NEXT_PUBLIC_RELEASE_COMMIT=" +
        source +
        "\n"
      : "";
  const previous = role === "web" ? `FROM ${parentWeb} AS static_parent\n` : "";
  const assets =
    role === "web"
      ? "COPY --from=static_parent /app/apps/web/.next/static/ .release-assets/previous/static/\nCOPY --from=static_parent /app/apps/web/.next/static-cohorts.json .release-assets/previous/static-cohorts.json\n"
      : "";
  const retention =
    role === "web"
      ? " && node scripts/retain-sharp-version-receipt.mjs && node scripts/retain-next-static-assets.mjs --current-dir apps/web/.next/static --previous-dir .release-assets/previous/static --cohort " +
        source
      : "";
  ok(
    executables.every(relative) &&
      new Set(executables).size === executables.length,
    "Invalid executable source paths",
  );
  const executableCopies = executables
    .map(
      (p) =>
        "COPY --chmod=0755 " +
        JSON.stringify(["source/" + p, "/vaettir-final-build/" + p]),
    )
    .join("\n");
  return `${previous}FROM ${builder} AS application_build\nUSER root\nWORKDIR /vaettir-final-build\n${args}ENV NODE_ENV=development\nCOPY source/ ./\n${executableCopies}\n${assets}RUN --network=none pnpm install --offline --frozen-lockfile && pnpm --filter @vaettir/db generate && node scripts/check-prisma-runtime.mjs && pnpm turbo run build --filter=@vaettir/${role}...${retention}\nFROM scratch AS compiled_application_evidence\nCOPY --from=application_build /vaettir-final-build/ /application/\n`;
}
export function prepareBuild(b, policy, role, io, files, modes) {
  const source = sourceAdmission(b, policy, io),
    item = b.builders[role],
    toolchain = completeImage(item.imageAcceptance, role, io.read);
  const review = accepted(
    item.cacheReview,
    io.read,
    "OFFLINE_APPLICATION_TOOLCHAIN",
  );
  ok(
    review.imageDigest === "sha256:" + toolchain.manifest.sha256 &&
      review.source === source.source &&
      review.tree === source.tree &&
      review.lockfileSha256 === sha(files["pnpm-lock.yaml"]) &&
      review.workspacePath === "/vaettir-final-build" &&
      review.workspaceAbsent === true &&
      review.cacheInventorySha256 === item.cacheInventory.sha256,
    "Exact offline dependency closure required",
  );
  const inv = jsonRef(item.cacheInventory, io.read, 256 * 1024 ** 2);
  ok(Array.isArray(inv) && inv.length > 0, "Empty cache inventory");
  validateToolchainFiles(
    completeInventoryRef(toolchain.inventory, io.read),
    inv,
  );
  verifyRef(item.cacheInventory, io.read);
  const parent = b.nativeBindings.baseline.web;
  const known = io.nativePolicy.roles.web.image;
  ok(known.includes("@sha256:"), "Pinned Web asset parent required");
  // Source tree has no mutable generated dependencies or private history.
  let total = 0;
  for (const [p, value] of Object.entries(files)) {
    ok(
      relative(p) &&
        !p
          .split("/")
          .some((x) =>
            [".local", ".git", "node_modules", "assistant-history"].includes(x),
          ),
      "Unsafe source member",
    );
    total += value.length;
    ok(total <= 512 * 1024 ** 2, "Source context too large");
  }
  ok(
    Object.keys(files).length <= 100000 &&
      Object.keys(files).some((x) => x.endsWith("/schema.prisma")),
    "Incomplete source tree",
  );
  ok(
    modes &&
      JSON.stringify(Object.keys(modes).sort()) ===
        JSON.stringify(Object.keys(files).sort()) &&
      Object.values(modes).every((m) => m === 0o644 || m === 0o755),
    "Exact Git file modes required",
  );
  return {
    source,
    files,
    modes,
    recipe: builderRecipe(
      role,
      toolchain.image,
      known,
      source.source,
      Object.keys(modes).filter((p) => modes[p] === 0o755),
    ),
    parentInventorySha256: parent.inventory.sha256,
    releaseAccepted: false,
  };
}
function gitFiles(repo, commit) {
  const options = {
    cwd: repo,
    timeout: 120000,
    maxBuffer: 128 * 1024 ** 2,
    env: {
      ...process.env,
      GIT_NO_REPLACE_OBJECTS: "1",
      GIT_OPTIONAL_LOCKS: "0",
    },
  };
  const rows = execFileSync(
    "git",
    ["ls-tree", "-rz", "--full-tree", commit],
    options,
  )
    .toString()
    .split("\0")
    .filter(Boolean);
  ok(rows.length <= 100000, "Too many source files");
  const files = {},
    modes = {};
  let total = 0;
  for (const r of rows) {
    const m = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(r);
    ok(m && relative(m[3]), "Unsupported Git source entry");
    const bytes = execFileSync("git", ["cat-file", "blob", m[2]], options);
    total += bytes.length;
    ok(total <= 512 * 1024 ** 2, "Source exceeds bound");
    files[m[3]] = bytes;
    modes[m[3]] = m[1] === "100755" ? 0o755 : 0o644;
  }
  return { files, modes };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [bindingPath, evidenceRoot, sourceRepo, role, output] =
    process.argv.slice(2);
  ok(
    ["api", "web"].includes(role) && output,
    "Expected BINDINGS EVIDENCE SOURCE role NEW_CONTEXT",
  );
  const b = JSON.parse(readFileSync(bindingPath)),
    policy = JSON.parse(readFileSync(join(here, "policy.json"))),
    io = actualIo(evidenceRoot, sourceRepo);
  sourceAdmission(b, policy, io);
  const git = gitFiles(sourceRepo, b.nativeBindings.source.commit);
  const result = prepareBuild(b, policy, role, io, git.files, git.modes);
  mkdirSync(output, { recursive: false, mode: 0o700 });
  writeFileSync(
    join(output, "build-context-intent.json"),
    encode({ source: result.source, once: true, releaseAccepted: false }),
    { flag: "wx", mode: 0o600 },
  );
  for (const [p, bytes] of Object.entries(result.files)) {
    const target = join(output, "source", p);
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    writeFileSync(target, bytes, { flag: "wx", mode: result.modes[p] });
  }
  writeFileSync(join(output, "Dockerfile"), result.recipe, {
    flag: "wx",
    mode: 0o600,
  });
  writeFileSync(
    join(output, "source-manifest.json"),
    encode({
      source: result.source,
      files: Object.entries(result.files).map(([path, v]) => ({
        path,
        sha256: sha(v),
        bytes: v.length,
        mode: result.modes[path],
      })),
      releaseAccepted: false,
    }),
    { flag: "wx", mode: 0o600 },
  );
}
