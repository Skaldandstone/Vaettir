import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { currentCaseVersionPreview } from "./case-version-baseline.ts";

const require = createRequire(import.meta.url);
const {
  QueryClient,
  QueryObserver,
  onlineManager,
} = require("@tanstack/react-query");

test("a real query cache's failed refetch cannot become a new version review baseline", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const queryKey = ["synthetic-case-preview", "case-one", 11];
  try {
    await client.fetchQuery({
      queryKey,
      queryFn: async () => ({ versionNumber: 11, revision: "old" }),
    });
    await assert.rejects(
      client.fetchQuery({
        queryKey,
        queryFn: async () => {
          throw new Error("Synthetic refresh authorization failure");
        },
      }),
    );
    const observer = new QueryObserver(client, { queryKey, enabled: false });
    const failed = observer.getCurrentResult();
    assert.equal(failed.data.revision, "old");
    assert.equal(failed.isFetching, false);
    assert.equal(failed.isRefetchError, true);
    assert.equal(currentCaseVersionPreview(failed, 11), null);
    await client.fetchQuery({
      queryKey,
      queryFn: async () => ({ versionNumber: 11, revision: "new" }),
    });
    const recovered = new QueryObserver(client, { queryKey, enabled: false });
    assert.equal(
      currentCaseVersionPreview(recovered.getCurrentResult(), 11)?.revision,
      "new",
    );
    observer.destroy();
    recovered.destroy();
  } finally {
    client.clear();
  }
});

test("a real paused refetch cannot approve its retained cached version preview", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.mount();
  const queryKey = ["synthetic-case-preview", "case-offline", 11];
  const queryFn = async () => ({ versionNumber: 11, revision: "new" });
  try {
    await client.fetchQuery({
      queryKey,
      queryFn: async () => ({ versionNumber: 11, revision: "old" }),
    });
    onlineManager.setOnline(false);
    const refresh = client.fetchQuery({ queryKey, queryFn });
    const observer = new QueryObserver(client, {
      queryKey,
      queryFn,
      enabled: false,
    });
    const paused = observer.getCurrentResult();
    assert.equal(paused.data.revision, "old");
    assert.equal(paused.error, null);
    assert.equal(paused.isFetching, false);
    assert.equal(paused.isPaused, true);
    assert.equal(currentCaseVersionPreview(paused, 11), null);
    onlineManager.setOnline(true);
    await refresh;
    const recovered = new QueryObserver(client, {
      queryKey,
      queryFn,
      enabled: false,
    });
    assert.equal(
      currentCaseVersionPreview(recovered.getCurrentResult(), 11)?.revision,
      "new",
    );
    observer.destroy();
    recovered.destroy();
  } finally {
    onlineManager.setOnline(true);
    client.unmount();
    client.clear();
  }
});

test("only successful idle identity-matched version previews are usable", () => {
  const data = { versionNumber: 11, revision: "reviewed" };
  const ready = { data, error: null, isFetching: false, isPaused: false };
  assert.equal(currentCaseVersionPreview(ready, 11), data);
  assert.equal(currentCaseVersionPreview(ready, 12), null);
  assert.equal(currentCaseVersionPreview(ready, null), null);
  assert.equal(
    currentCaseVersionPreview({ ...ready, data: undefined }, 11),
    null,
  );
  assert.equal(
    currentCaseVersionPreview({ ...ready, isFetching: true }, 11),
    null,
  );
  assert.equal(
    currentCaseVersionPreview({ ...ready, isPaused: true }, 11),
    null,
  );
  assert.equal(
    currentCaseVersionPreview({ ...ready, error: new Error("Refused") }, 11),
    null,
  );
});
