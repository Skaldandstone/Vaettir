# Production runtime identity evidence - 2026-09-24

Vaettir already validated release metadata while building images and rendering
ECS task definitions. The API process now independently enforces the runtime
contract: a production process refuses to start unless both its source commit
and immutable image digest are present, correctly formatted, and not the
all-zero infrastructure placeholders.

## Local evidence

- Five focused release-identity tests pass across a valid immutable identity,
  missing/malformed values, syntactically valid placeholders, production
  refusal, and development/test compatibility.
- The compiled bootstrap guard exits nonzero with production identity omitted
  and exits zero with a synthetic valid commit and digest.
- API typecheck, lint, and production TypeScript build pass.
- Focused formatting and `git diff --check` pass.

## Acceptance boundary

The tests prove the API startup guard and identity parser locally. They do not
prove an ECS task definition contains the intended values, an ECR digest maps
to the reviewed source, a deployed process has started successfully, health
endpoints are externally reachable, or rollback is safe. Those remain sealed
candidate and deployment evidence gates.

No AWS/provider/account mutation, credentials, production data change,
deployment, destructive action, or public release occurred in this slice.
