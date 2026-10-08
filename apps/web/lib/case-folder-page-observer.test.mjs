import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const page = readFileSync(new URL("../app/projects/[projectId]/test-cases/page.tsx", import.meta.url), "utf8");
test("repository page consumes the scoped folder query without child-to-parent state feedback", () => {
  assert.match(page, /folderCatalogQuery = trpcReact.caseFolders.list.useQuery/);
  assert.doesNotMatch(page, /setFolderCatalog|setFolderPaths|onFolderCatalog=/);
  assert.match(page, /onFolderPaths=\{ignoreFolderPaths\}/);
  assert.match(page, /folderCatalogQuery.isFetchedAfterMount && !folderCatalogQuery.isError && folderCatalogQuery.fetchStatus === "idle"/);
});
test("only the current exact actor and organization expose folder paths", () => {
  assert.match(page, /folderCatalog.organizationId === permissions.organizationId/);
  assert.match(page, /folderCatalog.clerkActorId === folderActor.userId/);
  assert.match(page, /folderPaths = currentFolderCatalog\?\.paths \?\? \[\]/);
});
