// Pure loopback synthetic UI tests; no authentication, customer data or API calls.
/* global window, document */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const require = createRequire(new URL("../package.json", import.meta.url));
const { chromium, expect } = require("@playwright/test");
const { build } = createRequire(
  createRequire(require.resolve("vitest")).resolve("vite"),
)("esbuild");
const root = fileURLToPath(new URL("../", import.meta.url));
const proof = fileURLToPath(
  new URL("../../../.local/compliance-coverage-20261030/", import.meta.url),
);
const css = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
).replace(/^@import[^\r\n]*\r?\n/gm, "");
const mocks = `import {useEffect,useState} from 'react';
import {TRPCClientError} from '@trpc/client';
export const state=window.syntheticState={allowed:true,mode:'normal',events:[],draft:null,frameworks:[{id:'saved-duplicate',name:'Music and performance rights',workspaceOwned:true,revision:1,controlCount:1,version:'1'}],setup:true};
const origin={organizationId:'org-original',clerkActorId:'actor-original'};
const row={id:'case-a',title:'License expiry',given:['Synthetic licensed asset'],when:['Inspect expiry'],then:['Expired permission is flagged'],steps:[{action:'Compare recorded expiry',expectedResult:'Expired license is flagged',expectedActionOrData:null,expectedResponse:null}],sharedSteps:null,reviewStatus:'PENDING_REVIEW'};
const outline={title:'Review music permission',prerequisite:'Synthetic use and territory',action:'Compare rights evidence',expectedResult:'Missing permission remains unresolved',customFields:{}};
const initial=()=>({id:'draft-a',digest:'a'.repeat(64),state:'DRAFT',authorityGeneration:0,scope:{scanned:1,total:1,omitted:0,archived:0,limit:2000,fields:'Synthetic title and procedure'},fields:{schema:{version:1,fields:[{key:'license_owner',label:'License owner',type:'TEXT',required:true,retired:false,options:[]}]},version:0},proposals:[{controlId:'control-a',code:'MUSIC',title:'Music permission',description:'Review use, territory and evidence',existing:[],matches:[{caseId:'case-a',title:'License expiry',titleTerms:['license'],procedureTerms:['expiry'],explanation:'Relevance only; not verified coverage.'}],kind:'UNCERTAIN',outline}],cases:[row],selection:[],receipt:null});
export function useCaseFieldAccess(){const [,rerender]=useState(0);useEffect(()=>{const refresh=()=>rerender(x=>x+1);window.addEventListener('access',refresh);return()=>window.removeEventListener('access',refresh)},[]);return {origin,canEdit:state.allowed,readable:state.allowed,owns:()=>state.allowed};}
export function useSearchParams(){return new URLSearchParams(state.setup?'setup=1':'');}
const q=data=>({data,isFetching:false,error:null,refetch:async()=>({data})});
const mutation=fn=>({useMutation:()=>({mutateAsync:fn,isPending:false})});
const utils={compliance:{reviewDraft:{fetch:async()=>{state.events.push({type:'read'});return state.draft;}},controlCoverage:{invalidate:async()=>{}}}};
export const trpcReact={useUtils:()=>utils,project:{byId:{useQuery:()=>q({qualityProfile:{complianceNeeds:['Music and performance rights']}})}},compliance:{
 catalog:{useQuery:()=>q([{id:'music-rights-us',name:'Music and performance rights',version:'1',category:'Content & rights',summary:'Synthetic reference',controls:1}])},
 listFrameworks:{useQuery:()=>q(state.frameworks)},reviewDrafts:{useQuery:()=>q([])},
 loadReference:mutation(async input=>{state.events.push({type:'load',input});return {id:'framework-a'}}),
 preview:mutation(async input=>{state.events.push({type:'preview',input});state.draft=initial();return state.draft;}),
 saveReview:mutation(async input=>{state.events.push({type:'save',input});if(!state.allowed)throw Error('Access changed');state.draft={...state.draft,selection:input.selection,digest:'b'.repeat(64)};return state.draft;}),
 applyReview:mutation(async input=>{state.events.push({type:'apply',input});if(state.mode==='conflict')throw TRPCClientError.from({error:{message:'Source changed; start a fresh review.',code:-32009,data:{code:'CONFLICT',httpStatus:409}}});if(!state.allowed)throw Error('Access changed');state.draft={...state.draft,state:'APPLIED',receipt:{requestId:input.requestId,draftId:'draft-a',reviewedDigest:input.expectedDigest,sourceDigest:'c'.repeat(64),createdIds:state.draft.selection.some(r=>r.newCase)?['new-a']:[],mappedCount:state.draft.selection.reduce((n,r)=>n+r.caseIds.length+(r.newCase?1:0),0),ordinaryCaseApproval:'PENDING_REVIEW',legalClearance:false}};if(state.mode==='lost-response')throw Error('Synthetic response lost after commit');return state.draft;})
}};`;
const bundle = await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {ComplianceReviewWorkflow} from './components/ComplianceReviewWorkflow';createRoot(document.getElementById('root')).render(<main style={{maxWidth:900,margin:'0 auto',padding:12}}><ComplianceReviewWorkflow projectId="project-a"/></main>);`,
    resolveDir: root,
    loader: "tsx",
  },
  plugins: [
    {
      name: "synthetic-api",
      setup(build) {
        build.onResolve(
          {
            filter:
              /^(@\/lib\/(trpcReact|use-case-field-access)|next\/navigation)$/,
          },
          () => ({ path: "synthetic", namespace: "synthetic" }),
        );
        build.onLoad({ filter: /.*/, namespace: "synthetic" }, () => ({
          contents: mocks,
          resolveDir: root,
          loader: "tsx",
        }));
        build.onResolve({ filter: /^@\// }, (args) => {
          const base = fileURLToPath(
            new URL("../" + args.path.slice(2), import.meta.url),
          );
          return {
            path: existsSync(base + ".tsx") ? base + ".tsx" : base + ".ts",
          };
        });
      },
    },
  ],
  bundle: true,
  write: false,
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
});
test("durable compliance review has explicit selection, ordinary approval, lost-response recovery and access fencing", async () => {
  const server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end(
      '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>',
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (const theme of ["light", "dark"])
      for (const width of [1280, 390]) {
        const context = await browser.newContext({
          viewport: { width, height: 1000 },
          hasTouch: width === 390,
        });
        const page = await context.newPage();
        const external = [],
          errors = [];
        page.on("pageerror", (e) => errors.push(String(e)));
        await page.route("**/*", (route) => {
          if (new URL(route.request().url()).origin !== origin) {
            external.push(route.request().url());
            return route.abort();
          }
          return route.continue();
        });
        try {
          await page.goto(origin);
          await page.addStyleTag({ content: css });
          await page.evaluate(
            (t) => (document.documentElement.dataset.theme = t),
            theme,
          );
          await page.addScriptTag({ content: bundle.outputFiles[0].text });
          await expect(
            page.getByText("Scanned 1 of 1 active cases.", { exact: false }),
          ).toBeVisible();
          assert.deepEqual(
            await page.evaluate(() =>
              window.syntheticState.events.map((e) => e.type),
            ),
            ["load", "preview"],
          );
          const match = page.getByRole("checkbox", {
            name: "License expiry",
            exact: true,
          });
          await expect(match).not.toBeChecked();
          const newCase = page.getByRole("checkbox", {
            name: "Propose a new case for ordinary review",
          });
          await expect(newCase).not.toBeChecked();
          await expect(
            page.getByRole("button", { name: "Apply reviewed selection" }),
          ).toBeDisabled();
          await match.focus();
          await page.keyboard.press("Space");
          await newCase.check();
          await page
            .getByRole("textbox", { name: "title", exact: true })
            .fill("Reviewed synthetic music permission");
          await expect(
            page.getByRole("button", { name: "Save selection" }),
          ).toBeDisabled();
          await page
            .getByRole("textbox", { name: /License owner/ })
            .fill("Synthetic rights reviewer");
          mkdirSync(proof, { recursive: true });
          await page.screenshot({
            path: proof + "workflow-review-" + theme + "-" + width + ".png",
            fullPage: true,
          });
          await page.getByRole("button", { name: "Save selection" }).click();
          await expect(
            page.getByRole("button", { name: "Apply reviewed selection" }),
          ).toBeEnabled();
          await page.evaluate(
            () => (window.syntheticState.mode = "lost-response"),
          );
          await page
            .getByRole("button", { name: "Apply reviewed selection" })
            .click();
          await expect(page.getByRole("alert")).toContainText(
            "Synthetic response lost",
          );
          await expect(match).toBeDisabled();
          await page
            .getByRole("button", {
              name: "Check outcome and retry same request",
            })
            .click();
          await expect(page.getByRole("status")).toContainText(
            "Saved 2 mappings and 1 proposed cases",
          );
          const events = await page.evaluate(
            () => window.syntheticState.events,
          );
          assert.equal(events.filter((e) => e.type === "apply").length, 1);
          assert.equal(events.filter((e) => e.type === "read").length, 1);
          assert.equal(
            events.find((e) => e.type === "save").input.selection[0].newCase
              .title,
            "Reviewed synthetic music permission",
          );
          assert.equal(
            await page.evaluate(
              () => window.syntheticState.draft.receipt.legalClearance,
            ),
            false,
          );
          mkdirSync(proof, { recursive: true });
          await page.screenshot({
            path: proof + "workflow-" + theme + "-" + width + ".png",
            fullPage: true,
          });
          await page
            .getByRole("button", { name: "Start a fresh review" })
            .click();
          await page.getByRole("button", { name: "Prepare review" }).click();
          await expect(
            page.getByRole("checkbox", { name: "License expiry", exact: true }),
          ).toBeVisible();
          await page.evaluate(() => {
            window.syntheticState.allowed = false;
            window.dispatchEvent(new Event("access"));
          });
          await expect(
            page.getByText(
              "Compliance review drafts are hidden until original editor access is verified.",
            ),
          ).toBeVisible();
          await expect(
            page.getByRole("checkbox", { name: "License expiry", exact: true }),
          ).toHaveCount(0);
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth,
            ),
            true,
          );
          assert.deepEqual(external, []);
          assert.deepEqual(errors, []);
        } finally {
          await context.close();
        }
      }
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
