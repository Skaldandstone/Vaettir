import {describe,expect,it} from "vitest";
import {productionSignalCapabilities} from "./productionSignalCapabilities.js";
describe("app-store connection availability, no credentials or provider calls",()=>{
  it("does not offer connections without encrypted storage",()=>{
    expect(productionSignalCapabilities({})).toEqual({googlePlayConnectAvailable:false,appleConnectAvailable:false,automaticSyncAvailable:false});
  });
  it("allows key setup when storage exists but never claims automatic sync",()=>{
    expect(productionSignalCapabilities({PRODUCTION_SIGNAL_ENCRYPTION_KEY:Buffer.alloc(32,3).toString("base64")})).toEqual({googlePlayConnectAvailable:false,appleConnectAvailable:true,automaticSyncAvailable:false});
  });
  it("offers Google only when existing OAuth and encrypted storage are both configured, without exposing them",()=>{
    const env={PRODUCTION_SIGNAL_ENCRYPTION_KEY:Buffer.alloc(32,3).toString("base64"),GOOGLE_PLAY_OAUTH_CLIENT_ID:"synthetic-client",GOOGLE_PLAY_OAUTH_CLIENT_SECRET:"synthetic-secret",GOOGLE_PLAY_OAUTH_REDIRECT_URI:"https://example.test/callback"};
    const result=productionSignalCapabilities(env);expect(result.googlePlayConnectAvailable).toBe(true);expect(JSON.stringify(result)).not.toContain("synthetic");
    expect(productionSignalCapabilities({...env,GOOGLE_PLAY_OAUTH_CLIENT_SECRET:undefined}).googlePlayConnectAvailable).toBe(false);
  });
  it("does not accept malformed storage keys",()=>{
    expect(productionSignalCapabilities({PRODUCTION_SIGNAL_ENCRYPTION_KEY:"invalid"}).appleConnectAvailable).toBe(false);
  });
});
