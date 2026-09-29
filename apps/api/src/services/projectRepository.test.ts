import {describe,it,expect} from "vitest";
import {validateRepositoryLocation} from "./projectRepository.js";
describe("repository registration",()=>{
 it("normalizes a repository web reference without reading it",()=>expect(validateRepositoryLocation("gitlab","https://gitlab.com/group/repo/")).toBe("https://gitlab.com/group/repo"));
 it("rejects credential-bearing and mismatched addresses",()=>{
  for(const url of ["https://user:secret@gitlab.com/group/repo","http://gitlab.com/group/repo","https://gitlab.com/group/repo?token=secret","https://github.com/group/repo","https://gitlab.com/"]) expect(()=>validateRepositoryLocation("gitlab",url)).toThrow();
 });
 it("accepts metadata for self-hosted and non-git web locations without claiming discovery",()=>expect(validateRepositoryLocation("perforce","https://swarm.example.test/project/main")).toBe("https://swarm.example.test/project/main"));
});
