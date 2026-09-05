import { timingSafeEqual } from "node:crypto";

// P6-07: GitLab project webhooks authenticate with one static shared-secret
// token you set when adding the webhook in GitLab's own UI - unlike
// GitHub's per-delivery HMAC signature over the raw body, there's no
// per-request computation here, just a direct compare against the
// X-Gitlab-Token header GitLab sends. Still timingSafeEqual, not ===, for
// the same reason githubApp.ts's HMAC compare is.
export function verifyGitlabToken(tokenHeader: string | undefined, secret: string): boolean {
  if (!tokenHeader || !secret) return false;
  const expected = Buffer.from(secret);
  const actual = Buffer.from(tokenHeader);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

// Unlike a GitHub App (one App-level credential, installed per-repo with no
// further setup), GitLab has no equivalent for a project webhook - posting
// a comment back needs a real personal/project access token with API scope,
// which the customer would generate in their own GitLab instance and give
// to Vaettir. No such token exists in this environment (same category of
// real-external-credential gap as the still-open GitHub App secrets in
// Secrets Manager, P10-02) - this function is real and correct, but
// genuinely unverified end-to-end against a live GitLab instance.
export async function postMergeRequestNote(
  gitlabBaseUrl: string,
  accessToken: string,
  projectId: number,
  mergeRequestIid: number,
  body: string,
): Promise<void> {
  const res = await fetch(`${gitlabBaseUrl}/api/v4/projects/${projectId}/merge_requests/${mergeRequestIid}/notes`, {
    method: "POST",
    headers: {
      "PRIVATE-TOKEN": accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    throw new Error(`GitLab note post failed: ${res.status} ${await res.text()}`);
  }
}
