import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Integration files share one disposable PostgreSQL schema. Fault-injection
    // CREATE/DROP TRIGGER takes relation-wide locks even when its row predicate
    // names only one synthetic case. Keep those files from blocking unrelated
    // fixtures; explicit Promise.all/multi-connection tests remain concurrent.
    // https://vitest.dev/config/fileparallelism
    fileParallelism: false,
  },
});
