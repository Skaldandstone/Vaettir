import {describe,it,expect} from "vitest";
import {availablePlatformRepositoryConfigurations,platformRepositoryApplication,platformRepositoryProvider} from "./platformRepositoryOAuth.js";
const env={GITLAB_OAUTH_CLIENT_ID:"synthetic-gitlab-id",GITLAB_OAUTH_CLIENT_SECRET:"synthetic-gitlab-secret",GITHUB_OAUTH_CLIENT_ID:"synthetic-github-id",GITHUB_OAUTH_CLIENT_SECRET:"synthetic-github-secret"};
describe("hosted OAuth application availability",()=>{
  it("exposes bounded descriptors without secrets/client IDs only when ready",()=>{
    expect(availablePlatformRepositoryConfigurations([],false,env)).toEqual([]);
    expect(availablePlatformRepositoryConfigurations([],true,env)).toEqual([{id:"platform:gitlab",provider:"gitlab",origin:"https://gitlab.com"},{id:"platform:github",provider:"github",origin:"https://github.com"}]);
    expect(JSON.stringify(availablePlatformRepositoryConfigurations([],true,env))).not.toContain("synthetic");
  });
  it("refuses partial, empty, whitespace, controls and oversized credentials",()=>{
    for(const invalid of [{},{GITLAB_OAUTH_CLIENT_ID:env.GITLAB_OAUTH_CLIENT_ID},{GITLAB_OAUTH_CLIENT_SECRET:env.GITLAB_OAUTH_CLIENT_SECRET},{GITLAB_OAUTH_CLIENT_ID:"",GITLAB_OAUTH_CLIENT_SECRET:env.GITLAB_OAUTH_CLIENT_SECRET},{GITLAB_OAUTH_CLIENT_ID:" ",GITLAB_OAUTH_CLIENT_SECRET:env.GITLAB_OAUTH_CLIENT_SECRET},{GITLAB_OAUTH_CLIENT_ID:"x".repeat(301),GITLAB_OAUTH_CLIENT_SECRET:env.GITLAB_OAUTH_CLIENT_SECRET},{GITLAB_OAUTH_CLIENT_ID:env.GITLAB_OAUTH_CLIENT_ID,GITLAB_OAUTH_CLIENT_SECRET:"x".repeat(2001)},{GITLAB_OAUTH_CLIENT_ID:env.GITLAB_OAUTH_CLIENT_ID,GITLAB_OAUTH_CLIENT_SECRET:"value\nsecret"},{GITLAB_OAUTH_CLIENT_ID:env.GITLAB_OAUTH_CLIENT_ID,GITLAB_OAUTH_CLIENT_SECRET:"value\u007fsecret"}]){
      expect(platformRepositoryApplication("gitlab",invalid)).toBeNull();expect(availablePlatformRepositoryConfigurations([],true,invalid)).toEqual([]);
    }
  });
  it("prefers each existing tenant hosted configuration, keeping self-hosted separate",()=>{
    const selfHosted={provider:"gitlab",origin:"https://gitlab.synthetic.example"};
    expect(availablePlatformRepositoryConfigurations([selfHosted],true,env)).toHaveLength(2);
    expect(availablePlatformRepositoryConfigurations([selfHosted,{provider:"gitlab",origin:"https://gitlab.com"}],true,env)).toEqual([{id:"platform:github",provider:"github",origin:"https://github.com"}]);
  });
  it("accepts only the two exact virtual identifiers",()=>{
    expect(platformRepositoryProvider("platform:github")).toBe("github");expect(platformRepositoryProvider("platform:gitlab")).toBe("gitlab");
    for(const id of ["platform:bitbucket","platform:gitlab:other","platform:GITLAB","gitlab","platform:github\n"]){expect(platformRepositoryProvider(id)).toBeNull();}
  });
});
