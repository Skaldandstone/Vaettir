import { describe, expect, it, vi } from "vitest";
import { createDatabaseCredentialMonitor, databaseCredentialLiveness } from "./databaseCredentialMonitor.js";

describe("managed database credential rotation", () => {
  it("withdraws a stale task from both container and load-balancer health checks", () => {
    expect(databaseCredentialLiveness(false)).toEqual({statusCode:200,body:{ok:true}});
    expect(databaseCredentialLiveness(true)).toEqual({statusCode:503,body:{ok:false}});
  });
  it("keeps unchanged credentials healthy and signals a confirmed change once", async () => {
    const resolveUrl = vi.fn().mockResolvedValueOnce("initial").mockResolvedValue("rotated");
    const onRotation = vi.fn();
    const monitor = createDatabaseCredentialMonitor({initialUrl:"initial",resolveUrl,onRotation,onCheckFailure:vi.fn()});
    await monitor.check();
    expect(monitor.status()).toEqual({rotated:false,checkFailed:false});
    await monitor.check();
    await monitor.check();
    expect(monitor.status().rotated).toBe(true);
    expect(onRotation).toHaveBeenCalledTimes(1);
    expect(resolveUrl).toHaveBeenCalledTimes(2);
  });

  it("does not evict a healthy task on a transient secret-read failure", async () => {
    const resolveUrl=vi.fn().mockRejectedValueOnce(new Error("private-secret")).mockResolvedValueOnce(undefined).mockResolvedValue("initial");
    const onRotation=vi.fn();
    const onCheckFailure=vi.fn();
    const monitor=createDatabaseCredentialMonitor({initialUrl:"initial",resolveUrl,onRotation,onCheckFailure});
    await monitor.check();
    expect(monitor.status()).toEqual({rotated:false,checkFailed:true});
    await monitor.check();
    await monitor.check();
    expect(monitor.status()).toEqual({rotated:false,checkFailed:false});
    expect(onRotation).not.toHaveBeenCalled();
    expect(onCheckFailure.mock.calls).toEqual([[],[]]);
  });

  it("coalesces overlapping checks", async () => {
    let finish!: (value:string)=>void;
    const resolveUrl=vi.fn(()=>new Promise<string>(resolve=>{finish=resolve;}));
    const monitor=createDatabaseCredentialMonitor({initialUrl:"initial",resolveUrl,onRotation:vi.fn(),onCheckFailure:vi.fn()});
    const first=monitor.check();
    await monitor.check();
    expect(resolveUrl).toHaveBeenCalledTimes(1);
    finish("initial");
    await first;
    expect(monitor.status().rotated).toBe(false);
  });
});
