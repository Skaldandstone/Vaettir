import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import nextConfig, { withNodeNextSourceAliases } from "../next.config.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const requireWeb = createRequire(new URL("../package.json", import.meta.url));
// Exercise the actual resolver shipped with our installed Next version, not a
// regex or a hand-written imitation. No compiler.run(), emit or network access.
const bundledWebpack = requireWeb("next/dist/compiled/webpack/webpack");
bundledWebpack.init();
const webpack = bundledWebpack.webpack;

function resolver(t, config = {}, fileSystem = fs) {
  const compiler = webpack({ mode: "none", entry: {}, ...config });
  compiler.inputFileSystem = fileSystem;
  t.after(
    () =>
      new Promise((done, reject) =>
        compiler.close((error) => (error ? reject(error) : done())),
      ),
  );
  const actual = compiler.resolverFactory.get("normal", {
    dependencyType: "esm",
  });
  return (from, request) =>
    new Promise((done, reject) => {
      actual.resolve({}, from, request, {}, (error, path) =>
        error ? reject(error) : done(path),
      );
    });
}

// In-memory regular-file fixtures: no temporary source files, dependency edits
// or imported fixture code. Resolve uses the installed enhanced-resolve graph.
function fixtureFileSystem(base, contents) {
  const files = new Map(
    Object.entries(contents).map(([name, content]) => [
      resolve(base, name),
      Buffer.from(content),
    ]),
  );
  const directories = new Set([base]);
  for (const path of files.keys()) {
    for (
      let parent = dirname(path);
      parent.startsWith(base);
      parent = dirname(parent)
    )
      directories.add(parent);
  }
  const owned = (path) => path === base || path.startsWith(base + sep);
  const missing = (path) =>
    Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
  return {
    ...fs,
    stat(path, callback) {
      if (!owned(path)) return fs.stat(path, callback);
      if (!files.has(path) && !directories.has(path))
        return callback(missing(path));
      callback(null, {
        isFile: () => files.has(path),
        isDirectory: () => directories.has(path),
        isSymbolicLink: () => false,
      });
    },
    readFile(path, ...args) {
      if (!owned(path)) return fs.readFile(path, ...args);
      const callback = args.at(-1);
      if (!files.has(path)) return callback(missing(path));
      callback(
        null,
        args[0] === "utf-8" || args[0] === "utf8"
          ? files.get(path).toString("utf8")
          : files.get(path),
      );
    },
    readlink(path, callback) {
      if (!owned(path)) return fs.readlink(path, callback);
      callback(
        Object.assign(new Error("Not a fixture symlink"), { code: "EINVAL" }),
      );
    },
  };
}

test("NodeNext fallback merges aliases and preserves security/resolver settings", () => {
  const resolveSettings = {
    fullySpecified: true,
    extensions: [".js"],
    alias: { existing: "/unchanged" },
    fallback: { fs: false },
    extensionAlias: { ".js": [".custom", ".js"], ".mjs": [".mjs", ".mts"] },
  };
  const config = {
    resolve: resolveSettings,
    module: { rules: [{ test: /existing/ }] },
  };
  const priorMjs = resolveSettings.extensionAlias[".mjs"];
  assert.equal(withNodeNextSourceAliases(config), config);
  assert.deepEqual(config.resolve.extensionAlias[".js"], [
    ".custom",
    ".js",
    ".ts",
    ".tsx",
  ]);
  assert.equal(config.resolve.extensionAlias[".mjs"], priorMjs);
  assert.equal(config.resolve.fullySpecified, true);
  assert.deepEqual(config.resolve.extensions, [".js"]);
  assert.deepEqual(config.resolve.fallback, { fs: false });
  assert.deepEqual(config.resolve.alias, { existing: "/unchanged" });
  assert.equal(config.module.rules.length, 1);
  withNodeNextSourceAliases(config);
  assert.equal(config.resolve.extensionAlias[".js"].length, 4);
  assert.deepEqual(
    withNodeNextSourceAliases({
      resolve: { extensionAlias: { ".js": ".custom" } },
    }).resolve.extensionAlias[".js"],
    [".custom", ".js", ".ts", ".tsx"],
  );
});

test("actual installed resolver reproduces and fixes all three failed nested API .js imports", async (t) => {
  const from = resolve(root, "apps/api/src/services");
  assert.match(
    fs.readFileSync(resolve(from, "caseCustomQuerySchema.ts"), "utf8"),
    /from "\.\/caseFieldSchema\.js"/,
  );
  const historySource = fs.readFileSync(
    resolve(from, "caseExecutionHistoryScopeSchema.ts"),
    "utf8",
  );
  assert.match(historySource, /from "\.\/reportDateIntervalSchema\.js"/);
  assert.match(historySource, /from "\.\/caseHistoryRunFiltersSchema\.js"/);
  const before = resolver(t, { resolve: { fullySpecified: true } });
  const after = resolver(
    t,
    withNodeNextSourceAliases({ resolve: { fullySpecified: true } }),
  );
  for (const name of [
    "caseFieldSchema",
    "reportDateIntervalSchema",
    "caseHistoryRunFiltersSchema",
  ]) {
    assert.equal(fs.existsSync(resolve(from, name + ".js")), false);
    await assert.rejects(before(from, "./" + name + ".js"), /Can't resolve/);
    assert.equal(
      await after(from, "./" + name + ".js"),
      resolve(from, name + ".ts"),
    );
  }
  await assert.rejects(
    after(from, "./missing-schema-fixture.js"),
    /Can't resolve/,
  );
});

test("actual resolver retains real JavaScript dependencies and existing mapping precedence", async (t) => {
  const base = resolve(root, ".local/__in_memory_node_next_resolution__");
  const contents = {
    "source/component.tsx": "not executed",
    "source/script.js": "not executed",
    "source/custom.custom": "not executed",
    "source/custom.ts": "not executed",
    "node_modules/published/internal.js": "published emitted JavaScript",
    "node_modules/published/internal.ts": "uncompiled neighboring source",
  };
  const fileSystem = fixtureFileSystem(base, contents);
  const normal = resolver(
    t,
    withNodeNextSourceAliases({
      resolve: { fullySpecified: true, descriptionFiles: [] },
    }),
    fileSystem,
  );
  assert.equal(
    await normal(resolve(base, "source"), "./component.js"),
    resolve(base, "source/component.tsx"),
  );
  assert.equal(
    await normal(resolve(base, "source"), "./script.js"),
    resolve(base, "source/script.js"),
  );
  assert.equal(
    await normal(resolve(base, "node_modules/published"), "./internal.js"),
    resolve(base, "node_modules/published/internal.js"),
  );
  const existing = resolver(
    t,
    withNodeNextSourceAliases({
      resolve: {
        fullySpecified: true,
        descriptionFiles: [],
        extensionAlias: { ".js": [".custom", ".js"] },
      },
    }),
    fileSystem,
  );
  assert.equal(
    await existing(resolve(base, "source"), "./custom.js"),
    resolve(base, "source/custom.custom"),
  );
  const real = resolver(t, withNodeNextSourceAliases({}));
  const installed = requireWeb.resolve("next/dist/compiled/webpack/webpack");
  assert.equal(await real(dirname(installed), "./webpack.js"), installed);
});

test("extension fallback does not bypass package export restrictions", async (t) => {
  const base = resolve(root, ".local/__in_memory_node_next_resolution__");
  const fileSystem = fixtureFileSystem(base, {
    "app/entry.js": "not executed",
    "node_modules/published/package.json": JSON.stringify({
      name: "published",
      exports: { ".": "./public.js" },
    }),
    "node_modules/published/public.js": "not executed",
    "node_modules/published/private.ts": "not exported",
  });
  const actual = resolver(t, withNodeNextSourceAliases({}), fileSystem);
  assert.equal(
    await actual(resolve(base, "app"), "published"),
    resolve(base, "node_modules/published/public.js"),
  );
  await assert.rejects(
    actual(resolve(base, "app"), "published/private.js"),
    /not exported/,
  );
});

test("Next configuration retains callback privacy headers, tracing and Sentry wrapper", async () => {
  assert.equal(typeof nextConfig.webpack, "function");
  assert.equal(
    nextConfig.output,
    process.env.VAETTIR_LOCAL_BUILD === "1" ? undefined : "standalone",
  );
  assert.deepEqual(nextConfig.transpilePackages, ["@vaettir/core"]);
  assert.equal(nextConfig.outputFileTracingRoot, root);
  const headers = await nextConfig.headers();
  for (const provider of ["gitlab", "github"]) {
    assert.deepEqual(
      headers.find(
        (value) => value.source === `/connections/${provider}/callback`,
      ).headers,
      [
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Cache-Control", value: "no-store" },
      ],
    );
  }
  assert.match(
    fs.readFileSync(new URL("../next.config.mjs", import.meta.url), "utf8"),
    /export default withSentryConfig\(nextConfig,/,
  );
});

test("actual Sentry-wrapped Next hook preserves NodeNext aliases", async () => {
  const configured = await nextConfig.webpack(
    {
      plugins: [],
      module: { rules: [] },
      resolve: { extensionAlias: { ".mjs": [".mjs", ".mts"] } },
    },
    {
      dev: true,
      isServer: false,
      dir: resolve(root, "apps/web"),
      config: nextConfig,
      buildId: "synthetic-resolver-only",
      webpack,
    },
  );
  assert.deepEqual(configured.resolve.extensionAlias[".js"], [
    ".js",
    ".ts",
    ".tsx",
  ]);
  assert.deepEqual(configured.resolve.extensionAlias[".mjs"], [".mjs", ".mts"]);
});
