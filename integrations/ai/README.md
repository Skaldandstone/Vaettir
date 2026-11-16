# Vaettir AI access

Version 0.2.0 adds selected-case disclosure to the local Codex package. It is
source under validation, not a deployed or OpenAI-approved public listing.
The installed 0.1.6 preview remains counts-only until separately updated.

| Capability | Approval |
| --- | --- |
| Synthetic quality counts | Exact project, current administrator, expiry; small cohorts withheld |
| Selected case fields | Preview up to 20 exact cases and choose title/Given/When/Then fields; approve the content and attest it contains no regulated data |
| Regulated or unclassified project | Denied |
| Writes, attachments, logs, source, custom fields | Unavailable |

Human access does not grant external AI access. Selected-case approval supports
synthetic or customer-proprietary projects. It stores only selected identifiers,
field names and a digest, not another retained copy of customer text. Every read
rebuilds that exact projection from the original cases and checks its digest.
Changed selected text, archived/deleted cases or changed classification require
new approval. This is an administrator review, not an automatic PHI detector.

Both capabilities require current tenant membership/seat/identity, an active
approving administrator and organization, an unrevoked expiring dedicated grant,
and exact operator deployment scope. Existing database withdrawal triggers
permanently revoke both grant types. The audit must commit before disclosure.

vai_ credentials are bearer capabilities. Anyone holding one can exercise its
approved read scope; the recipient label does not attest the caller's executable.
Keep them in private connection settings, never chat, source or shared documents.
They cannot authenticate to the general API. Counts-only grants cannot read
cases; selected-case grants cannot request project counts. No automatic retries
or alternate API/export/browser paths are allowed after denial.

The case capability is separately off by default:
VAETTIR_AI_CASE_DISCLOSURE_ENABLED=1 also requires the existing disclosure flag
and exact VAETTIR_AI_DISCLOSURE_PROJECTS pairs. Customer approval remains
required for each grant. This source does not turn any production flag on.

Run npm ci, npm run build, then npm test here. Dependencies and generated
bundles stay outside Git. Review [RELEASE-REVIEW.md](./RELEASE-REVIEW.md) before
deploying or installing a candidate. Remote OAuth, ChatGPT connection testing,
directory submission and real customer/provider acceptance remain separate gates.

The previous installation and counts-only setup reference is retained in
[LEGACY-COUNTS.md](./LEGACY-COUNTS.md); its historical limits do not describe 0.2.0.
