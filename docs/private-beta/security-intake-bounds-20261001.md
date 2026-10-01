# Defensive intake and runtime dependency checkpoint

This is a source-only security correction to the all-chip checkpoint. It does
not establish deployment, provider acceptance, or a clean whole-workspace audit.
No imported code is executed and no customer records or stored policies are
rewritten by this correction.

## Spreadsheet intake

The three XLSX preview/import routes parse in an isolated app-owned worker.
Only one worker runs per API process, with no retained-input queue. Parsing has
an eight-second termination deadline, cancellation, and V8 heap limits. The
compiled API uses its own adjacent compiled worker, not customer code.

Inputs fail closed rather than silently truncating beyond these bounds:

| Boundary | Limit |
| --- | --- |
| Compressed upload | 10 MiB |
| Expanded archive entry | 10 MiB |
| Declared expanded archive total | 50 MiB |
| Archive entries / worksheets | 20,000 / 50 |
| Rows per worksheet / workbook | 10,000 / 20,000 |
| Columns / workbook cells | 256 / 200,000 |
| Characters per cell / converted CSV total | 16,384 / 20 MiB |

Archive bounds precede decoding. Unsupported XML declarations, malformed cell
references and excessive cell structures are rejected. Standard XML escapes and
numeric Unicode references decode once, while CDATA remains literal. Native buffers are not
covered by V8 heap limits, so byte limits and worker termination are independent
controls. Actor memberships are freshly read after parsing and before import writes; cancellation
and a changed project tenant prevent commit. Normal mapping and review remain.

## Repository risk-policy paths

Path rules use iterative bounded expansion and matching instead of recursive
glob evaluation. Supported forms include ordinary `*`, `**`, `?`, character
classes and small brace alternatives/ranges. Save validation explicitly rejects
unsupported advanced forms and excess complexity. Existing stored rules remain
unchanged; unsafe evaluation cannot downgrade a configured CRITICAL policy.

Bounds are 50 rules, 256 pattern characters, 1,024 path characters, 64 segments,
32 alternatives, four brace levels, 512 tokens and 250,000 shared match operations.
An oversized stored policy has a conservative CRITICAL uncertainty marker,
without inventing or persisting replacement rules.
The editor rejects oversized stored policies instead of presenting a truncated
editable subset that could erase undisplayed rules on save.

The mobile client consumes the API's generated declaration contract rather than
typechecking server implementation in its unrelated CommonJS module context.
Existing workspace typecheck/test dependencies build that contract first; no
compiler strictness or runtime authentication behavior is changed.

## Dependency and release boundaries

The reviewed lockfile updates Next.js within version 15, Sharp, PostCSS, AdmZip,
Fastify, brace-expansion, fast-uri and ip-address to patched versions. Installed
dependency tests resolve image/CSS dependencies from Next itself. Primary
maintainer references include [Next.js](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4),
[Sharp](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c),
[PostCSS](https://github.com/postcss/postcss/security/advisories/GHSA-fxqj-rqcc-2cmp),
and [AdmZip](https://github.com/cthackers/adm-zip/security/advisories/GHSA-7q85-xj36-vmfc).

The whole-workspace production dependency audit still fails for mobile/Expo
dependency paths. No findings are suppressed and no mobile major upgrade is
included. An API/web dependency-path result is not a full container image scan.
Production release remains frozen pending exact-commit checks and normal
runtime/migration/recovery/authenticated-smoke gates. Previously built images
remain preserved but are not approval to deploy the superseded checkpoint.
