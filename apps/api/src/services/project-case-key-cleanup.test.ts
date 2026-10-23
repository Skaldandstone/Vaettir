import { describe,expect,it,vi } from "vitest";
import { waitForOwnedEmptyFixtureDatabase } from "../testOnlyFixtureDatabaseCleanup.js";
const row={owner:"synthetic-role",role:"synthetic-role",marker:"synthetic-purpose",sessions:0n};
describe("owned isolated database cleanup drain (synthetic observations, no database deletion)",()=>{
  it("requires an actual zero-session observation after disconnect acknowledgement",async()=>{
    const read=vi.fn().mockResolvedValueOnce({...row,sessions:1n}).mockResolvedValue(row);
    expect(await waitForOwnedEmptyFixtureDatabase(read,row.marker,Date.now()+500)).toEqual(row);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it.each([{name:"foreign owner",change:{owner:"foreign-role"}},{name:"foreign marker",change:{marker:"foreign-purpose"}},{name:"invalid count",change:{sessions:-1n}}])("refuses $name without waiting",async({change})=>{
    const read=vi.fn(async()=>({...row,...change}));
    await expect(waitForOwnedEmptyFixtureDatabase(read,row.marker,Date.now()+500)).rejects.toThrow();
    expect(read).toHaveBeenCalledOnce();
  });
  it("does not reinterpret still-active sessions as empty at the deadline",async()=>{
    await expect(waitForOwnedEmptyFixtureDatabase(async()=>({...row,sessions:1n}),row.marker,Date.now()-1)).rejects.toThrow("still has active sessions");
  });
});
