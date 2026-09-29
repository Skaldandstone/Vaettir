# Project population release, September 29, 2026

## Release candidate

Application commit: `a42765ca480322cbff0be06ac059f4819605b53d`.

- API CodeBuild: `vaettir-api-build:26918238-4047-4d8d-a316-85f87c03862d`, SUCCEEDED.
- Web CodeBuild: `vaettir-web-build:f28c0a60-2ce9-4b4f-882f-1047c56fd30e`, SUCCEEDED.
- API task definition: `vaettir-api:22`, image `sha256:67c0e42963cf794f3a1871ac7d02d48155f0d13c4e60d3b40f66f13b4aab19cd`.
- Web task definition: `vaettir-web:15`, image `sha256:9a6ce86f2773d5a34a2415a49e7e5c372c4b2338aea4c30fc21c48f9d55cd08a`.
- Previous definitions retained: API 21, web 14. Full pre-release definitions and release metadata remain in ignored `.local/deploy-a42765c/`.

The first builds failed on Docker Hub's anonymous pull rate limit before compilation. The replacement uses the official Docker Node distribution on ECR Public, pinned to its verified OCI index digest. No assertion or security check was bypassed.

## Service-window handling

The existing daily 01:00 Pacific stop had scaled both services to zero and stopped `vaettir-postgres`. Both ECS deployments still reported COMPLETED, which is not runtime acceptance. The database was started for the explicitly authorized overnight deployment, became available, and API desired count was restored to one. The existing 08:00–01:00 schedule was not modified. Database backup retention was seven days, with latest restorable time 07:57:03 UTC before startup.

`scripts/check-ecs-release.mjs` now rejects zero desired/running tasks, pending or mismatched counts, wrong task revisions, incomplete/multiple deployments and failed task attempts. Its four new tests and all nine operations tests pass. This operational helper is a subsequent source-only commit, not part of the application image.

## Verification boundary

Pre-release evidence: API 359 tests against a fresh disposable local database, core 68, web contracts 35, root typecheck seven tasks, focused lint, synthetic rendered flow checks, and successful Linux API/web image builds. The migrations only add population tables and constraints; they do not rewrite customer records.

At approximately 02:28 Pacific, both services passed the runtime acceptance checker with one running task, zero pending tasks and one COMPLETED deployment. Both load-balancer targets were healthy. API logs confirmed all three population migrations successfully applied. `/api/health/detailed` returned healthy database/worker status and the exact API commit/digest above.

Authenticated read-only browser checks on the existing demo project verified all four setup steps, document consent/disabled preview behavior, requirements empty state and the evidence snapshot with existing cases. No draft, document, requirement or test record was written during these checks. Production save/retry behavior remains supported by isolated database tests, not a customer-data mutation. Provider/device acceptance and mobile/multirole testing remain separate.

Rendered inspection found nested main landmarks in the three population subpages. A follow-up removes those nested landmarks, gives the document page a level-one heading and adds a structural regression test. It requires a subsequent web build/deployment; do not claim this fix is in the a42765c image.

## Accessibility follow-up

Web-only commit `a8556f2771fde92ea3820b27e5bfaa1f20f3a20a` passed CodeBuild `vaettir-web-build:d9e3fc55-eacf-4d31-94d4-d400f066f746` and deployed as `vaettir-web:16`, digest `sha256:2cd9b66b1e41b78772e2a22c9742fd36abd0788f3e99919da24d6edafadbaa9d`. Runtime acceptance passed (one completed deployment, running one, pending zero); the new target was healthy while the previous target drained. Authenticated document-page inspection confirmed a single main landmark and level-one heading. API remains `a42765c` / revision 22. No new migration or customer write accompanied this web correction.

Scope and remaining limitations are recorded in [project-population-20260929.md](project-population-20260929.md). This is the saved-setup, reviewed-document, cited-requirement and evidence-snapshot slice, not completed multi-provider discovery or test/strategy generation.
