import { describe, it, expect } from "vitest";
import { devNull } from "node:os";
import { assertScannableRepoUrl, cloneInvocation } from "./repositoryTransport.js";

describe("legacy repository transport guard", () => {
  it("allows explicit hosted repository identities", () => {
    for (const url of ["https://github.com/org/repo.git", "https://gitlab.com/group/sub/repo.git", "https://bitbucket.org/team/repo", "https://dev.azure.com/org/project/_git/repo"])
      expect(() => assertScannableRepoUrl(url)).not.toThrow();
  });
  it("refuses internal, attacker, ambiguous and credential-bearing destinations", () => {
    for (const url of ["file:///tmp/repo", "ssh://github.com/org/repo", "https://127.0.0.1/a/b", "https://169.254.169.254/a/b",
      "https://github.com.attacker.example/a/b", "https://github.com@evil.example/a/b", "https://token@github.com/a/b",
      "https://github.com:444/a/b", "https://github.com/a/b?next=internal", "https://github.com/a/b#ref", "https://github.com/a/%2e%2e/b",
      "https://github.com/a", "https://gitlab.example/a/b", "https://github.com\\@evil.example/a/b"])
      expect(() => assertScannableRepoUrl(url)).toThrow();
  });
  it("disables redirects, inherited config/helpers, prompts, hooks and submodules", () => {
    const { args, options } = cloneInvocation("https://github.com/org/repo", "fixture-dir", "main");
    expect(args).toContain("http.followRedirects=false");
    expect(args).toContain("credential.helper=");
    expect(args).toContain(`core.hooksPath=${devNull}`);
    expect(args).toContain("--template=");
    expect(args).toContain("--no-recurse-submodules");
    expect(args.slice(-3)).toEqual(["--", "https://github.com/org/repo", "fixture-dir"]);
    expect(options).toMatchObject({ cwd: "fixture-dir", timeout: 120000, maxBuffer: 1048576, windowsHide: true });
    expect(options.env).toMatchObject({ GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: devNull, GIT_ALLOW_PROTOCOL: "https", GIT_TERMINAL_PROMPT: "0" });
    expect(Object.keys(options.env).filter(key => /proxy|token|password|secret|askpass/i.test(key))).toEqual([]);
  });
  it("rejects option-like and malformed branches before starting git", () => {
    for (const ref of ["", "--upload-pack=evil", "main\nother", "main\0other"])
      expect(() => cloneInvocation("https://github.com/org/repo", "fixture-dir", ref)).toThrow();
    expect(cloneInvocation("https://github.com/org/repo", "fixture-dir").args).not.toContain("--depth");
  });
});
