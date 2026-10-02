import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canEditProject,
  canAdministerOrganization,
  canSignOffCompliance,
  isReadOnlySeat,
  roleLabel,
  organizationAccessMessage,
} from "./membership.ts";
import { assertTestEnvironment } from "../e2e/test-environment.ts";
import { saveRequirementDrafts } from "./requirement-drafts.ts";
import { creditOperationLabel } from "./credit-labels.ts";
import { nextPopulationStep } from "./population-navigation.ts";
import { readDocumentFile } from "./document-file.ts";

test("workspace lookup failures are not represented as role denials", () => {
  assert.equal(organizationAccessMessage({isError:true,isPending:false}), "Workspace permissions unavailable");
  assert.equal(organizationAccessMessage({isError:false,isPending:true}), "Checking workspace permissions");
  assert.equal(organizationAccessMessage({isError:false,isPending:false}), "Admin access required");
  const menu = readFileSync(new URL("../components/NavAuth.tsx", import.meta.url), "utf8");
  assert.match(menu, /!orgsQuery.isError && !orgsQuery.isPending && canAdministerOrganization/);
  assert.match(menu, /Retry workspace permissions/);
});

test("source chips open modal actions and keep unsupported provider status honest", () => {
  const chips = readFileSync(new URL("../components/SourceConnectionChips.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(chips, /type="checkbox"/);
  assert.match(chips, /<Modal/);
  assert.match(chips, /account discovery is not available/);
  assert.match(chips, /<PopulationDocuments/);
  assert.match(chips, /ProviderMark/);
  const wizard = readFileSync(new URL("../components/PopulationWizard.tsx", import.meta.url), "utf8");
  assert.match(wizard, /<SourceConnectionChips/);
  assert.doesNotMatch(wizard, /title="Source preferences/);
  assert.match(chips, /projectId&&visitedRepositories.map/);
  assert.match(chips, /hidden=\{selectedRepository!==provider\}/);
  assert.match(chips, /<RepositoryConnectionContent projectId=\{projectId\} provider=\{provider\}/);
  assert.match(chips, /utils.project.repositories.invalidate\(\{projectId\}\)/);
  for (const path of ["../app/projects/[projectId]/requirements/page.tsx", "../app/projects/[projectId]/reverse-engineer/page.tsx"]) {
    const page = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(page, /#project-repositories/);
    assert.match(page, /<SourceConnectionChips projectId=\{projectId\} only=\{\["github", "gitlab", "bitbucket", "azure-devops", "git", "perforce", "svn"\]\}/);
  }
  const overview = readFileSync(new URL("../app/projects/[projectId]/page.tsx", import.meta.url), "utf8");
  assert.match(overview, /<ProjectRepositories/);
  assert.doesNotMatch(overview, /Connect a GitHub repo|Connect repository/);
  const projects = readFileSync(new URL("../app/projects/page.tsx", import.meta.url), "utf8");
  assert.match(projects, /\?setup=1/);
  assert.doesNotMatch(projects, /setRepoUrl|value=\{repoUrl\}/);
});

test("token chips review metadata without source access and routing freezes the approved baseline",()=>{
  const token=readFileSync(new URL("../components/TokenRepositoryConnection.tsx",import.meta.url),"utf8");
  assert.match(token,/approveMetadataAccess:true/);assert.match(token,/catalogVersion:listing.catalogVersion/);
  assert.match(token,/Source files have not been read/);assert.match(token,/setToken\(""\)/);
  const signals=readFileSync(new URL("../components/ProductionSignalChips.tsx",import.meta.url),"utf8");
  assert.match(signals,/const \[baseline\]=useState/);assert.match(signals,/expectedRoute:baseline!.route/);
  assert.match(signals,/eventId:"\$ID"/);assert.match(signals,/does not contact the provider or verify delivery/);
});

function documentFile(name, contents) {
  const bytes = new TextEncoder().encode(contents);
  return { name, size: bytes.byteLength, arrayBuffer: async () => bytes.buffer };
}
test("role labels are human readable without changing stored enum values", () => {
  assert.equal(roleLabel("COMPLIANCE_AUDITOR"), "Compliance auditor");
  assert.equal(roleLabel("ADMIN"), "Admin");
  assert.equal(roleLabel("FUTURE_ROLE"), "future role");
});
test("document file accepts UTF-8 Markdown/text/README without executing markup", async () => {
  const content = '# Intent\r\nThe device shall report temperature. ✓\n<script>doNotRun()</script>';
  for (const name of ["spec.md", "SPEC.MARKDOWN", "spec.txt", "README"])
    assert.equal(await readDocumentFile(documentFile(name, content)), content);
});
test("document file rejects non-text types before reading their bytes", async () => {
  for (const name of ["credentials.env", "private.pem", "archive.zip", "document.pdf", "image.png", "readme.md.exe"]) {
    await assert.rejects(readDocumentFile({ name, size: 20, arrayBuffer: () => { throw new Error("must not read"); } }), /Choose a Markdown/);
  }
});
test("document file bounds bytes and decoded characters and rejects invalid content", async () => {
  await assert.rejects(readDocumentFile({name: "x.txt", size: 200001, arrayBuffer: () => { throw new Error("must not read"); }}), /200 KB/);
  await assert.rejects(readDocumentFile(documentFile("x.txt", "a".repeat(50001))), /50,000/);
  for (const text of ["\0binary", "escape\x1b", "\u007f"]) await assert.rejects(readDocumentFile(documentFile("x.txt", text)), /control characters/);
  await assert.rejects(readDocumentFile(documentFile("x.txt", "  \n")), /no text/);
  await assert.rejects(readDocumentFile({name:"x.txt",size:1,arrayBuffer:async()=>new Uint8Array([255]).buffer}), /UTF-8/);
  await assert.rejects(readDocumentFile({name:"x.txt",size:2,arrayBuffer:async()=>new Uint8Array([65]).buffer}), /size changed/);
});

test("population subpages reuse the layout main landmark", () => {
  for (const section of ["documents", "requirements", "assessment"]) {
    const source = readFileSync(new URL(`../app/projects/[projectId]/populate/${section}/page.tsx`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /<main\b/);
  }
  const documents = readFileSync(new URL("../components/PopulationDocuments.tsx", import.meta.url), "utf8");
  assert.match(documents, /<h1>Project documents<\/h1>/);
});

test("partial project setup skips only unselected sections in either direction", () => {
  assert.equal(nextPopulationStep(0, 1, ["assessment"]), "review");
  assert.equal(nextPopulationStep(3, 2, ["assessment"]), "scope");
  assert.equal(nextPopulationStep(0, 1, ["sources"]), "sources");
  assert.equal(nextPopulationStep(3, 2, ["context"]), "context");
  assert.equal(nextPopulationStep(0, 1, ["context", "sources"]), "context");
  assert.throws(() => nextPopulationStep(0, -1, []), /Invalid wizard step/);
  assert.throws(() => nextPopulationStep(0, 4, []), /Invalid wizard step/);
});

test("credit operations have user-facing labels with a readable fallback", () => {
  assert.equal(
    creditOperationLabel("generateAutomationDraft"),
    "Draft framework-specific automation",
  );
  assert.equal(
    creditOperationLabel("extractRequirementsFromMarkdown"),
    "Extract requirements from a document",
  );
  assert.equal(creditOperationLabel("newOperation_name"), "New Operation name");
});

test("requirement review keeps acknowledged rows out of retries", async () => {
  const rows = ["One", "Two", "Three"].map((title) => ({
    title,
    description: "Expected behavior",
    sourceFile: null,
  }));
  const saved = new Set();
  const calls = [];
  await assert.rejects(
    saveRequirementDrafts(
      rows,
      [0, 1, 2],
      saved,
      async (draft) => {
        calls.push(draft.title);
        if (draft.title === "Two") throw new Error("temporary failure");
      },
      (index) => saved.add(index),
    ),
    /temporary failure/,
  );
  assert.deepEqual([...saved], [0]);
  rows[1].title = "Repaired second requirement";
  await saveRequirementDrafts(
    rows,
    [0, 1, 2],
    saved,
    async (draft) => calls.push(draft.title),
    (index) => saved.add(index),
  );
  assert.deepEqual(calls, [
    "One",
    "Two",
    "Repaired second requirement",
    "Three",
  ]);
  assert.deepEqual([...saved], [0, 1, 2]);
});

test("blank selected requirement blocks the batch without dropping rows", async () => {
  const rows = [
    { title: "Good", description: "", sourceFile: null },
    { title: "  ", description: "Repair me", sourceFile: null },
  ];
  let writes = 0;
  await assert.rejects(
    saveRequirementDrafts(
      rows,
      [0, 1],
      new Set(),
      async () => writes++,
      () => {},
    ),
    /Add a title/,
  );
  assert.equal(writes, 0);
  assert.equal(rows[1].description, "Repair me");
});

test("requirement review saves edited text and source attribution only for selected rows", async () => {
  const writes = [];
  await saveRequirementDrafts(
    [
      { title: "  Edited  ", description: "Acceptance", sourceFile: "spec.md" },
      { title: "Later", description: "", sourceFile: null },
    ],
    [0],
    new Set(),
    async (draft) => writes.push(draft),
    () => {},
  );
  assert.deepEqual(writes, [
    { title: "Edited", description: "Acceptance\n\n(extracted from spec.md)" },
  ]);
});

for (const role of [
  "OWNER",
  "ADMIN",
  "EDITOR",
  "COMPLIANCE_AUDITOR",
  "VIEWER",
  "UNKNOWN",
]) {
  for (const seatType of ["FULL", "READ_ONLY", "UNKNOWN"]) {
    test(`UI capabilities: ${role}/${seatType}`, () => {
      const member = { role, seatType };
      assert.equal(
        canEditProject(member),
        seatType === "FULL" && ["OWNER", "ADMIN", "EDITOR"].includes(role),
      );
      assert.equal(
        canAdministerOrganization(member),
        seatType === "FULL" && ["OWNER", "ADMIN"].includes(role),
      );
      assert.equal(
        canSignOffCompliance(member),
        seatType === "FULL" &&
          ["OWNER", "ADMIN", "COMPLIANCE_AUDITOR"].includes(role),
      );
    });
  }
}

test("unknown membership fails closed", () => {
  assert.equal(isReadOnlySeat(undefined), true);
  for (const member of [null, undefined]) {
    assert.equal(canEditProject(member), false);
    assert.equal(canAdministerOrganization(member), false);
    assert.equal(canSignOffCompliance(member), false);
  }
});

const local = {
  DATABASE_URL:
    "postgresql://test:local@127.0.0.1:55440/vaettir_browser_test?schema=public",
  PLAYWRIGHT_BASE_URL: "http://localhost:3000",
  NEXT_PUBLIC_API_URL: "http://localhost:4000",
  CLERK_SECRET_KEY: "sk_test_placeholder",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_placeholder",
};
test("test guard permits local isolated development data", () =>
  assert.doesNotThrow(() => assertTestEnvironment(local)));
for (const [name, change] of Object.entries({
  "production database": { DATABASE_URL: "postgresql://127.0.0.1/vaettir" },
  "remote database": {
    DATABASE_URL: "postgresql://database.example/vaettir_browser_test",
  },
  "database host override": {
    DATABASE_URL: `${local.DATABASE_URL}&host=remote.example`,
  },
  "non-postgres database": {
    DATABASE_URL: "https://localhost/vaettir_browser_test",
  },
  "production web": {
    PLAYWRIGHT_BASE_URL: "https://vaettir.skaldandstone.com",
  },
  "remote API": { NEXT_PUBLIC_API_URL: "https://api.example.com" },
  "non-HTTP web": { PLAYWRIGHT_BASE_URL: "file://localhost/path" },
  "credentials in URL": { NEXT_PUBLIC_API_URL: "http://token@localhost:4000" },
  "production Clerk secret": { CLERK_SECRET_KEY: "sk_live_placeholder" },
  "production Clerk public key": {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_placeholder",
  },
}))
  test(`test guard rejects ${name}`, () =>
    assert.throws(() => assertTestEnvironment({ ...local, ...change })));
