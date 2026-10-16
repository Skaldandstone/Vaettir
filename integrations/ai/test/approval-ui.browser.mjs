// Actual ReactDOM controls, synthetic auth/RPC boundaries, no customer session.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const requireWeb = createRequire(join(repo, "apps/web/package.json"));
const { chromium } = requireWeb("@playwright/test");
const output = join(repo, ".local/ai-plugin-grants-20261016/ui-" + Date.now());
await mkdir(output, { recursive: true });
const rpcPath = join(output, "rpc.ts"),
  authPath = join(output, "auth.ts"),
  entryPath = join(output, "entry.tsx");
await writeFile(authPath, "export const useAuth = () => window.fixture.auth;");
await writeFile(
  rpcPath,
  `export const trpcReact = {
 aiDisclosure:{settings:{useQuery:()=>({data:window.fixture.settings,error:null,isFetching:false,isPaused:false,refetch:async()=>({data:window.fixture.settings,error:null})})}},
 useUtils:()=>({client:{aiDisclosure:Object.fromEntries(['classify','issue','rotate','revoke'].map(kind=>[kind,{mutate:input=>window.fixture.mutate(kind,input)}]))}})
};`,
);
await writeFile(
  entryPath,
  `
import React from ${JSON.stringify(join(repo, "apps/web/node_modules/react/index.js"))};
import {createRoot} from ${JSON.stringify(join(repo, "apps/web/node_modules/react-dom/client.js"))};
import {AiDisclosureSettings} from ${JSON.stringify(join(repo, "apps/web/components/AiDisclosureSettings.tsx"))};
const f=window.fixture={auth:{userId:'owner-a',sessionId:'session-a',isLoaded:true,isSignedIn:true},props:{projectId:'project-a',organizationId:'org-a',canConfigure:true},
 settings:{projectId:'project-a',organizationId:'org-a',actorClerkUserId:'owner-a',classification:'UNCLASSIFIED',version:0,enabled:false,observedAt:'2026-10-16T22:00:00Z',grants:[],grantLimitReached:false,audit:[]},calls:[],lost:false,delay:false,revoked:false};
const root=createRoot(document.getElementById('app'));f.render=()=>root.render(<AiDisclosureSettings {...f.props}/>);
f.mutate=async(kind,input)=>{
 f.calls.push({kind,input});
 if(f.delay)await new Promise(done=>f.release=done);
 if(kind==='classify'){f.settings.classification=input.classification;f.settings.version++;}
 if(kind==='issue'){if(!f.settings.grants.some(g=>g.id==='grant-a'))f.settings.grants.push({id:'grant-a',recipient:'codex',scope:'aggregate_counts',keyHint:'vai_aaaaaaaa',version:1,classificationVersion:f.settings.version,enabled:true,revokedAt:null,expiresAt:'2099-01-01',createdAt:'2026-10-16',lastUsedAt:null});}
 if(kind==='revoke'){f.settings.grants[0].enabled=false;f.settings.grants[0].revokedAt='2026-10-16';f.settings.grants[0].version++;}
 if(f.revoked&&f.settings.grants[0])f.settings.grants[0].revokedAt='2026-10-16';
 if(f.lost&&!f.failed){f.failed=true;throw new Error('Synthetic lost reply');}
 return {operation:kind.toUpperCase(),policyVersion:f.settings.version,grantId:kind==='classify'?null:'grant-a',grantVersion:1,token:['issue','rotate'].includes(kind)&&!f.failed?'vai_'+'a'.repeat(64):null,replayed:!!f.failed};
};f.render();`,
);
const bundled = await build({
  absWorkingDir: repo,
  entryPoints: [entryPath],
  nodePaths: [join(repo, "apps/web/node_modules")],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  jsx: "automatic",
  alias: { "@/lib/trpcReact": rpcPath, "@clerk/nextjs": authPath },
  define: { "process.env.NODE_ENV": '"production"' },
});
const browser = await chromium.launch({ headless: true });
const fixtureServer = createServer((_request, response) => {
  response.writeHead(200, {
    "content-type": "text/html",
    "content-security-policy": "connect-src 'none'",
  });
  response.end('<html><body><main id="app"></main></body></html>');
});
await new Promise((done) => fixtureServer.listen(0, "127.0.0.1", done));
const fixtureOrigin = "http://127.0.0.1:" + fixtureServer.address().port;
async function page() {
  const p = await browser.newPage({ viewport: { width: 1180, height: 1100 } });
  p.setDefaultTimeout(5000);
  p.on("pageerror", (error) =>
    console.error("Synthetic browser error:", error.message),
  );
  await p.route("**/*", (route) =>
    route
      .request()
      .url()
      .startsWith(fixtureOrigin + "/")
      ? route.continue()
      : route.abort(),
  );
  await p.goto(fixtureOrigin);
  const css = (
    await readFile(join(repo, "apps/web/app/globals.css"), "utf8")
  ).replace(/^@import[^\n]+\n/gm, "");
  await p.addStyleTag({
    content: css + "\n#app{max-width:1080px;margin:28px auto;padding:0 20px}",
  });
  await p.addScriptTag({ content: bundled.outputFiles[0].text });
  await p.getByRole("heading", { name: "External AI access" }).waitFor();
  return p;
}
async function classify(p) {
  await p.locator("select").first().selectOption("SYNTHETIC");
  await p.getByLabel("I reviewed this project", { exact: false }).check();
  await p
    .getByRole("button", {
      name: "Save classification and revoke earlier grants",
    })
    .click();
  await p
    .getByText("Classification saved. Earlier grants are revoked.", {
      exact: true,
    })
    .waitFor();
}
async function approve(p) {
  await p
    .getByLabel("I approve these synthetic aggregate counts", { exact: false })
    .check();
}

try {
  await test("actual approval controls require classification and explicit approval; credential is masked and dismissible", async () => {
    const p = await page();
    assert.equal(
      await p
        .getByRole("button", { name: "Approve and issue credential" })
        .isDisabled(),
      true,
    );
    await classify(p);
    await approve(p);
    await p
      .getByRole("button", { name: "Approve and issue credential" })
      .click();
    const key = p.getByLabel("One-time AI credential");
    await key.waitFor();
    assert.equal(await key.getAttribute("type"), "password");
    assert.equal(await key.inputValue(), "vai_" + "a".repeat(64));
    await p.getByRole("button", { name: "Reveal credential" }).click();
    assert.equal(await key.getAttribute("type"), "text");
    await p.getByRole("button", { name: "Hide credential" }).click();
    await p.screenshot({
      path: join(output, "approval-controls.png"),
      fullPage: true,
    });
    await p.getByRole("button", { name: "Dismiss credential" }).click();
    assert.equal(await key.count(), 0);
    await p.close();
  });
  await test("a lost approval reply recovers the identical request without reissuing or recovering its credential", async () => {
    const p = await page();
    await classify(p);
    await approve(p);
    await p.evaluate(() => {
      window.fixture.lost = true;
    });
    await p
      .getByRole("button", { name: "Approve and issue credential" })
      .click();
    await p.getByRole("button", { name: "Recover pending request" }).click();
    await p
      .getByText("This request was already recorded.", { exact: false })
      .waitFor();
    const calls = await p.evaluate(() =>
      window.fixture.calls.filter((c) => c.kind === "issue"),
    );
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].input, calls[1].input);
    assert.equal(await p.getByLabel("One-time AI credential").count(), 0);
    await p.close();
  });
  await test("a rapid duplicate click submits only one approval", async () => {
    const p = await page();
    await classify(p);
    await approve(p);
    await p.evaluate(() => {
      window.fixture.delay = true;
    });
    await p
      .getByRole("button", { name: "Approve and issue credential" })
      .evaluate((el) => {
        el.click();
        el.click();
      });
    assert.equal(
      await p.evaluate(
        () => window.fixture.calls.filter((c) => c.kind === "issue").length,
      ),
      1,
    );
    await p.evaluate(() => window.fixture.release());
    await p.getByLabel("One-time AI credential").waitFor();
    await p.close();
  });
  await test("a late reply cannot reveal a credential after the account/session changes", async () => {
    const p = await page();
    await classify(p);
    await approve(p);
    await p.evaluate(() => {
      window.fixture.delay = true;
    });
    await p
      .getByRole("button", { name: "Approve and issue credential" })
      .click();
    await p.evaluate(() => {
      window.fixture.auth.userId = "owner-b";
      window.fixture.auth.sessionId = "session-b";
      window.fixture.render();
    });
    await p
      .getByText("Administrator access could not yet be verified.", {
        exact: false,
      })
      .waitFor();
    await p.evaluate(() => window.fixture.release());
    assert.equal(await p.getByLabel("One-time AI credential").count(), 0);
    await p.close();
  });
  await test("revocation controls clear the displayed credential and report the revoked state", async () => {
    const p = await page();
    await classify(p);
    await approve(p);
    await p
      .getByRole("button", { name: "Approve and issue credential" })
      .click();
    await p.getByLabel("One-time AI credential").waitFor();
    await p.getByRole("button", { name: "Revoke connection" }).click();
    await p
      .getByText("Connection revoked. New reads are blocked.", { exact: true })
      .waitFor();
    assert.equal(await p.getByLabel("One-time AI credential").count(), 0);
    await p.close();
  });
  await test("a credential revoked before the final access refresh is never displayed", async () => {
    const p = await page();
    await classify(p);
    await approve(p);
    await p.evaluate(() => {
      window.fixture.revoked = true;
    });
    await p
      .getByRole("button", { name: "Approve and issue credential" })
      .click();
    await p
      .getByText("Approval changed before the credential could be shown.", {
        exact: false,
      })
      .waitFor();
    assert.equal(await p.getByLabel("One-time AI credential").count(), 0);
    await p.close();
  });
} finally {
  await browser.close();
  await new Promise((done) => fixtureServer.close(done));
}
console.log("Synthetic browser evidence:", output);
