import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const root = new URL('../../', import.meta.url);
const require = createRequire(new URL('package.json', root));
const eslint = createRequire(require.resolve('@eslint/eslintrc/package.json'));
const yaml = eslint('js-yaml');
const semver = eslint('semver');
const read = file => readFileSync(new URL(file, root), 'utf8');
const workflow = file => yaml.load(read(`.github/workflows/${file}.yml`));
const action = 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020';

test('runtime declaration meets pinned pnpm floor without moving the CI application to Node 23/24', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.packageManager, 'pnpm@11.23.0');
  assert.equal(pkg.engines.node, '>=22.13');
  assert.equal(semver.satisfies('22.12.0', pkg.engines.node), false);
  assert.equal(semver.satisfies('22.13.0', pkg.engines.node), true);
  assert.equal(semver.satisfies(process.versions.node, pkg.engines.node), true);
  for (const name of ['ci', 'release-validation']) {
    for (const job of Object.values(workflow(name).jobs)) {
      for (const step of job.steps.filter(step => step.uses?.startsWith('actions/setup-node@'))) {
        assert.equal(step.uses, action);
        assert.equal(semver.satisfies('22.12.0', step.with['node-version']), false);
        assert.equal(semver.satisfies('22.13.0', step.with['node-version']), true);
        assert.equal(semver.satisfies('23.0.0', step.with['node-version']), false);
        if (step.with.cache) assert.equal(step.with.cache, 'pnpm');
        else assert.equal(step.with['package-manager-cache'], false);
      }
    }
  }
});

test('CI trigger behavior and manual release/deploy holds are explicit and unchanged', () => {
  const ci = workflow('ci'), release = workflow('release-validation'), deploy = workflow('deploy');
  // CI was NOT manual-only at the inspected baseline. Do not misreport it.
  assert.deepEqual(Object.keys(ci.on).sort(), ['pull_request', 'push']);
  assert.deepEqual(ci.on.push.branches, ['master']);
  assert.deepEqual(Object.keys(release.on), ['workflow_dispatch']);
  assert.deepEqual(Object.keys(deploy.on), ['workflow_dispatch']);
  for (const name of ['live_ai', 'android_compile', 'container_compile']) assert.equal(release.on.workflow_dispatch.inputs[name].default, false);
  assert.equal(release.jobs.android.if, 'inputs.android_compile');
  assert.equal(release.jobs.containers.if, 'inputs.container_compile');
  assert.equal(deploy.jobs.deploy.environment, 'production');
  assert.equal(deploy.concurrency['cancel-in-progress'], false);
  assert.deepEqual(ci.permissions, { contents: 'read' });
  assert.deepEqual(release.permissions, { contents: 'read' });
  assert.match(deploy.jobs.deploy.steps[0].run, /AWS_DEPLOY_ROLE_ARN/);
});

test('pnpm is installed before its explicit setup-node cache restore', () => {
  const steps = workflow('ci').jobs.build.steps;
  const pnpm = steps.findIndex(step => step.uses?.startsWith('pnpm/action-setup@'));
  const cache = steps.findIndex(step => step.uses === action && step.with.cache === 'pnpm');
  assert.ok(pnpm > 0 && cache > pnpm);
  assert.equal(steps[pnpm].with.run_install, false);
});

test('Docker context explicitly excludes local mobile/signing artifacts while retaining patched install inputs', () => {
  const patterns = read('.dockerignore').split(/\r?\n/).filter(line => line && !line.startsWith('#'));
  for (const pattern of ['**/node_modules', '**/.local', '**/.env.*', 'apps/mobile/build', '**/.gradle', '**/*.apk', '**/*.aab', '**/*.apks', '**/*.ipa', '**/*.mobileprovision', '**/*.p8', 'apps/mobile/credentials.json', 'NEEDS_ATTENTION.md']) assert.ok(patterns.includes(pattern), pattern);
  for (const file of ['patches/image-size@1.2.1.patch', 'patches/@expo__cli@0.22.28.patch', 'pnpm-workspace.yaml', 'pnpm-lock.yaml']) {
    assert.ok(existsSync(new URL(file, root)));
    assert.ok(!patterns.includes(file));
  }
  assert.ok(!patterns.includes('patches') && !patterns.includes('**/*.patch'));
  for (const name of ['Dockerfile.api', 'Dockerfile.web']) {
    const source = read(name);
    assert.ok(source.indexOf('COPY . .') < source.indexOf('pnpm install --frozen-lockfile'));
    assert.match(source, /^FROM node:22-slim/m);
  }
  // Source contract only. These checks do not execute Docker's matcher/build.
});

test('resolved web configuration disables unused Next image-processing entry points', async () => {
  const { default: exported } = await import(new URL('apps/web/next.config.mjs', root));
  const config = typeof exported === 'function' ? await exported('phase-production-build', { defaultConfig: {} }) : exported;
  assert.equal(config.images.unoptimized, true);
  assert.equal(config.images.disableStaticImages, true);
  // Runtime HTTP verification remains necessary. This is not a parser patch.
});

function middlewareHarness() {
  const ts = require('typescript');
  const compiled = ts.transpileModule(read('apps/web/middleware.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const calls = [];
  let publicPatterns;
  const exports = {};
  runInNewContext(compiled.outputText, { exports, require(name) {
    if (name === 'next/server') return { NextResponse: Response };
    assert.equal(name, '@clerk/nextjs/server');
    return {
      createRouteMatcher(patterns) {
        publicPatterns = Array.from(patterns);
        return req => publicPatterns.some(pattern => pattern.endsWith('(.*)') ? req.nextUrl.pathname.startsWith(pattern.slice(0, -4)) : req.nextUrl.pathname === pattern);
      },
      clerkMiddleware(handler) {
        return async (req, event) => {
          calls.push({ req, event });
          await handler({ protect: async () => { throw new Error('auth denied'); } }, req);
          return 'clerk-public-result';
        };
      },
    };
  } });
  return { ...exports, calls, publicPatterns };
}

test('disabled optimizer responds before Clerk without reading untrusted URL data', async () => {
  const harness = middlewareHarness();
  const req = { nextUrl: { pathname: '/_next/image', get searchParams() { throw new Error('must not read supplied URL'); } } };
  const response = await harness.default(req, {});
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(await response.text(), '');
  assert.equal(harness.calls.length, 0);
  assert.deepEqual(Array.from(harness.config.matcher), ['/((?!_next|.*\\..*).*)', '/(api|trpc)(.*)', '/__clerk/:path*', '/_next/image']);
});

test('all other routes keep their existing Clerk public/protected handling', async () => {
  const harness = middlewareHarness();
  assert.deepEqual(harness.publicPatterns, ['/', '/beta-guide', '/sign-in(.*)', '/sign-up(.*)']);
  for (const route of ['/', '/beta-guide', '/sign-in', '/sign-up/verify']) {
    const req = { nextUrl: { pathname: route } }, event = {};
    assert.equal(await harness.default(req, event), 'clerk-public-result');
    assert.equal(harness.calls.at(-1).req, req);
    assert.equal(harness.calls.at(-1).event, event);
  }
  for (const route of ['/projects', '/settings/billing', '/admin', '/api/private', '/_next/image-other', '/__clerk/test']) {
    await assert.rejects(harness.default({ nextUrl: { pathname: route } }, {}), /auth denied/);
  }
});
