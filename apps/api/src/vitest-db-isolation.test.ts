import { describe, expect, it } from "vitest";
import { configDefaults } from "vitest/config";
import config from "../vitest.config.js";

describe("shared PostgreSQL schema fixture isolation", () => {
  it("serializes files without excluding suites or overriding test/time/isolation semantics", ({
    task,
  }) => {
    expect(config.test).toEqual({
      environment: "node",
      fileParallelism: false,
    });
    expect(config.test).not.toHaveProperty("testTimeout");
    expect(config.test).not.toHaveProperty("hookTimeout");
    expect(config.test).not.toHaveProperty("include");
    expect(config.test).not.toHaveProperty("exclude");
    expect(config.test).not.toHaveProperty("isolate");
    expect(config.test).not.toHaveProperty("sequence");
    expect(config.test).not.toHaveProperty("maxConcurrency");
    expect(config.test).not.toHaveProperty("maxWorkers");
    expect(task.timeout).toBe(5000);
    expect(configDefaults.isolate).toBe(true);
  });

  it("retains explicit concurrently-started operations inside a running file", async () => {
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    const work = async (name: string) => {
      started.push(name);
      await gate;
      return name;
    };
    const completion = Promise.all([work("first"), work("second")]);
    expect(started).toEqual(["first", "second"]);
    release();
    expect(await completion).toEqual(["first", "second"]);
  });
});
