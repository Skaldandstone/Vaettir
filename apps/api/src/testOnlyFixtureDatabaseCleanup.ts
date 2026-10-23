import assert from "node:assert/strict";
export type OwnedFixtureDatabase = { owner: string; role: string; marker: string | null; sessions: bigint };
/** Pure admission polling; never drops databases or terminates sessions. The
 * caller separately verifies its localhost test URL and exact generated name. */
export async function waitForOwnedEmptyFixtureDatabase(read:()=>Promise<OwnedFixtureDatabase|undefined>,marker:string,deadline:number){
  for(;;){
    const owned=await read();
    assert.ok(owned&&owned.owner===owned.role&&owned.marker===marker,"Synthetic database ownership/marker changed; cleanup refused");
    assert.ok(typeof owned.sessions==="bigint"&&owned.sessions>=0n,"Synthetic database session evidence is unavailable");
    if(owned.sessions===0n)return owned;
    const remaining=deadline-Date.now();
    assert.ok(remaining>0,"Owned synthetic database still has active sessions; cleanup refused");
    await new Promise<void>(done=>setTimeout(done,Math.min(25,remaining)));
  }
}
