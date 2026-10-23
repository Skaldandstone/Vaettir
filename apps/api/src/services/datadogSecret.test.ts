import {afterEach,describe,expect,it,vi} from "vitest";
import {encryptToken} from "./tokenEncryption.js";
import {readDatadogSecret} from "./datadogSecret.js";
afterEach(()=>vi.unstubAllEnvs());
describe("Datadog secret compatibility",()=>{
  it("preserves legacy secrets and decrypts encrypted replacements without exposing plaintext",()=>{
    vi.stubEnv("PRODUCTION_SIGNAL_ENCRYPTION_KEY",Buffer.alloc(32,8).toString("base64"));
    expect(readDatadogSecret({datadogWebhookSecret:"legacy-fixture"})).toBe("legacy-fixture");
    const encrypted=encryptToken("encrypted-fixture");
    expect(JSON.stringify(encrypted)).not.toContain("encrypted-fixture");
    expect(readDatadogSecret({datadogWebhookSecret:"legacy-fixture",encryptedDatadogWebhookSecret:encrypted})).toBe("encrypted-fixture");
  });
  it("fails closed for corrupt ciphertext or unavailable encryption key",()=>{
    vi.stubEnv("PRODUCTION_SIGNAL_ENCRYPTION_KEY",Buffer.alloc(32,8).toString("base64"));
    const encrypted=encryptToken("synthetic");
    expect(()=>readDatadogSecret({datadogWebhookSecret:"legacy",encryptedDatadogWebhookSecret:{...encrypted,authTag:"invalid"}})).toThrow();
    vi.stubEnv("PRODUCTION_SIGNAL_ENCRYPTION_KEY","");
    expect(()=>readDatadogSecret({datadogWebhookSecret:"legacy",encryptedDatadogWebhookSecret:encrypted})).toThrow();
  });
});
