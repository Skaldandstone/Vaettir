import { describe, expect, it } from "vitest";
import { gitlabInstanceOrigin } from "./gitlab-instance-selection";

describe("GitLab instance selection", () => {
  it("accepts a pasted dashboard or repository URL, retaining its own host", () => {
    expect(gitlabInstanceOrigin("https://gitlab.example.org/dashboard/projects")).toBe("https://gitlab.example.org");
    expect(gitlabInstanceOrigin(" https://GitLab.Example.org/group/repo ")).toBe("https://gitlab.example.org");
    expect(gitlabInstanceOrigin("https://gitlab.com")).toBe("https://gitlab.com");
  });
  it.each(["", "gitlab.example.org", "http://gitlab.example.org", "https://user:secret@gitlab.example.org", "https://gitlab.example.org/?token=secret", "https://gitlab.example.org/#secret", "https://localhost", "https://127.0.0.1", "https://[::1]", "https://gitlab.internal", "https://gitlab.example.org:8443", "https://gitlab.example.org/" + "a".repeat(301)])("refuses unsuitable UI routing input without returning any of it: %s", value => {
    expect(gitlabInstanceOrigin(value)).toBeNull();
  });
});
