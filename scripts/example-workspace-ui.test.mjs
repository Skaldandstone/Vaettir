// Render the actual sidebar, account menu and preference store. RPC/auth are
// synthetic boundaries; no customer session or external network is available.
/* global window */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { before, after, test } from "node:test";
const require = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const ts = require("typescript"),
  { chromium } = require("@playwright/test");
function component(path) {
  const source = ts.createSourceFile(
    path,
    readFileSync(new URL("../" + path, import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const withoutImports = ts.factory.updateSourceFile(
    source,
    source.statements.filter((statement) => !ts.isImportDeclaration(statement)),
  );
  return ts
    .transpileModule(ts.createPrinter().printFile(withoutImports), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.React,
      },
    })
    .outputText.replace(/^export /gm, "");
}
const compiled = [
  "apps/web/lib/example-workspace-preference.ts",
  "apps/web/components/Sidebar.tsx",
  "apps/web/components/NavAuth.tsx",
]
  .map(component)
  .join("\n");
const scripts = {
  "/react.js": readFileSync(
    join(
      dirname(require.resolve("react/package.json")),
      "umd/react.development.js",
    ),
  ),
  "/react-dom.js": readFileSync(
    join(
      dirname(require.resolve("react-dom/package.json")),
      "umd/react-dom.development.js",
    ),
  ),
};
const boot = `
const {useSyncExternalStore,useState,useEffect,useRef}=React;
const Link=({href,children,...props})=>React.createElement("a",{href,...props},children);
const Icon=()=>null, usePathname=()=>"/projects", useRouter=()=>({push(){}});
const isNavigationActive=(path,href)=>path===href;
const useAuth=()=>({isLoaded:true,isSignedIn:true});
const useUser=()=>({user:{fullName:"Synthetic owner",primaryEmailAddress:{emailAddress:"synthetic@example.invalid"}}});
const useClerk=()=>({openUserProfile(){},signOut(){}});
const trpcReact={organization:{mine:{useQuery:()=>({data:[{name:"Synthetic workspace",role:"OWNER",seatType:"FULL"}]})}}};
const canAdministerOrganization=()=>true, organizationAccessMessage=()=>"";
`;
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="/react.js"></script><script src="/react-dom.js"></script><script type="module">${boot}\n${compiled}
ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(React.Fragment,null,React.createElement(Sidebar),React.createElement(NavAuth)));
</script></body></html>`;
let server, browser, origin;
before(async () => {
  server = createServer((req, res) => {
    res.setHeader(
      "content-type",
      scripts[req.url] ? "application/javascript" : "text/html",
    );
    res.end(scripts[req.url] ?? html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = "http://127.0.0.1:" + server.address().port;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});
async function open(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  await page.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort(),
  );
  await page.goto(origin);
  await page.getByRole("link", { name: "Projects", exact: true }).waitFor();
  return page;
}
test("X removes the complete sidebar entry, survives reload, and can be restored from the account menu", async () => {
  const context = await browser.newContext();
  const page = await open(context);
  try {
    await page.getByRole("button", { name: "Hide example workspace" }).click();
    assert.equal(
      await page
        .locator("aside")
        .getByText(/example workspace/i)
        .count(),
      0,
    );
    await page.reload();
    await page.getByRole("link", { name: "Projects", exact: true }).waitFor();
    assert.equal(
      await page
        .locator("aside")
        .getByText(/example workspace/i)
        .count(),
      0,
    );
    await page
      .getByRole("button", { name: "Open account and workspace menu" })
      .click();
    await page
      .getByRole("button", { name: "Show example workspace", exact: true })
      .click();
    await page
      .getByRole("link", { name: "Example workspace", exact: true })
      .waitFor();
    await page.reload();
    await page
      .getByRole("link", { name: "Example workspace", exact: true })
      .waitFor();
  } finally {
    await context.close();
  }
});
test("existing hidden preferences and other tabs update without a leftover sidebar row", async () => {
  const context = await browser.newContext();
  const first = await open(context),
    second = await open(context);
  try {
    await first.getByRole("button", { name: "Hide example workspace" }).click();
    await second
      .getByRole("link", { name: "Example workspace", exact: true })
      .waitFor({ state: "hidden" });
    assert.equal(
      await second
        .locator("aside")
        .getByText(/example workspace/i)
        .count(),
      0,
    );
    const third = await open(context);
    assert.equal(
      await third
        .locator("aside")
        .getByText(/example workspace/i)
        .count(),
      0,
    );
    await second
      .getByRole("button", { name: "Open account and workspace menu" })
      .click();
    await second
      .getByRole("button", { name: "Show example workspace", exact: true })
      .click();
    await first
      .getByRole("link", { name: "Example workspace", exact: true })
      .waitFor();
  } finally {
    await context.close();
  }
});
test("dismiss and restore still work for the session when browser storage is unavailable", async () => {
  const context = await browser.newContext();
  await context.addInitScript(() =>
    Object.defineProperty(window, "localStorage", {
      get() {
        throw Error("Synthetic storage denial");
      },
    }),
  );
  const page = await open(context);
  try {
    await page.getByRole("button", { name: "Hide example workspace" }).click();
    assert.equal(
      await page
        .locator("aside")
        .getByText(/example workspace/i)
        .count(),
      0,
    );
    await page
      .getByRole("button", { name: "Open account and workspace menu" })
      .click();
    await page
      .getByRole("button", { name: "Show example workspace", exact: true })
      .click();
    await page
      .getByRole("link", { name: "Example workspace", exact: true })
      .waitFor();
  } finally {
    await context.close();
  }
});
