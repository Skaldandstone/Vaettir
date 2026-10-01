import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
test('web build imports only immutable predecessor static assets and exports the cohort manifest',()=>{
 const build=read('buildspec.web.yml');
 assert.match(build,/vaettir-web@sha256:/);
 assert.match(build,/docker cp vaettir-previous-web:\/app\/apps\/web\/\.next\/static /);
 assert.match(build,/docker cp vaettir-previous-web:\/app\/apps\/web\/\.next\/static-cohorts.json /);
 assert.doesNotMatch(build,/docker cp [^\n]+\/(public|server) /);
 assert.match(build,/test "\$CODEBUILD_BUILD_SUCCEEDING" = "1"/);
 const docker=read('Dockerfile.web');
 assert.match(docker,/retain-next-static-assets.mjs/);
 assert.match(docker,/COPY --from=builder[^\n]+static-cohorts.json/);
 assert.match(docker,/LABEL vaettir.next-static-cohorts="1"/);
});
test('normal release supplies immutable previous web identity without changing API builds',()=>{
 const release=read('scripts/deploy-aws.sh');
 assert.match(release,/VAETTIR_PREVIOUS_WEB_IMAGE/);
 assert.match(release,/VAETTIR_PREVIOUS_WEB_COMMIT/);
 assert.match(release,/buildspec=\(--buildspec-override buildspec.web.yml\)/);
 assert.match(read('apps/web/next.config.mjs'),/deploymentId: process.env.NEXT_PUBLIC_RELEASE_COMMIT/);
 assert.match(read('.dockerignore'),/^\.local$/m);
 assert.match(read('.gitignore'),/^\/\.release-assets\/$/m);
});
test('expired client assets offer an explicit reload without automatically discarding in-progress input',()=>{
 const boundary=read('apps/web/app/global-error.tsx');
 assert.match(boundary,/ChunkLoadError\|Loading chunk/);
 assert.match(boundary,/An update is available/);
 assert.match(boundary,/Unsaved changes may be lost/);
 assert.match(boundary,/onClick=\{\(\) => window.location.reload\(\)\}/);
 assert.match(boundary,/Sentry.captureException\(error\)/);
});
