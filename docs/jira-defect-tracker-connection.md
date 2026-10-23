# Jira defect tracker connection

Start **Connect Jira tracker** from the Defect map or Project integrations →
Jira & Confluence. This uses the existing Jira Cloud connector: verify account
and project metadata, select projects, then separately approve a bounded read
of issue summaries. Existing verified access can be resumed.

The supported credential is a standard Jira Cloud API token without scopes.
Saved access is encrypted and expires in Vaettir after eight hours. Browser
OAuth, scoped tokens and self-hosted Jira are not supported by this connector.
The supplied account's provider permissions remain its own; Vaettir does not
claim that a standard token is intrinsically read-only.

Each run reads at most five pages and 100 issue summaries from up to 20 approved
projects. Identity, title, status, update time and source link are staged.
Descriptions, comments, attachments and code are excluded. No AI runs.

Finish the snapshot, select issues, review **defect tasks**, and explicitly
approve saving them. This path creates no requirements and does not modify
Jira. Task source identity uses the verified site, approved project and native
issue ID; the displayed key comes from the verified source link. Titles over
the defect map's 180-character capacity are rejected for review, never truncated.
Jira's arbitrary status labels are not guessed into resolution categories;
task status remains unknown. The source preview retains the original label.

At preview and first write, the server checks the actor, current full editor
membership, workspace, project, run version and expiry, and live connection
scope. The source snapshot and current map version are bound to the approval.
The write and provenance audit commit in one transaction. Replaying a completed
receipt acknowledges its original result without another write, provider read
or source disclosure, including when source access has subsequently expired.

The UI retains an unconfirmed request across a saved-status refresh failure,
closing and reopening the module. Its selection cannot change while the result
is unknown. A known rejection can return to review; ambiguous results retain
the exact request for retry. Reloading or leaving the page discards browser
draft state; saved source runs and committed map evidence remain durable.

Snapshots are refreshed manually. Missing tasks and prior human link decisions
remain retained; Jira task status never establishes a runtime fix. Connecting
Jira as a source is separate from sharing Vaettir quality information back to
Jira or Confluence through the verified Atlassian app workflow.
