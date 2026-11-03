# Narrow Prisma schema RPC repair

Source-only v2 successor; frozen a88 and the first repair53df/v1 stay unchanged.
Use this v2 instead of v1: v1 retained EOF-only success shutdown. Main owns all
actual native, database, container, cloud, build and release operations. No new
application build is required by this diagnostic-source change.

Only `schemaRpc` changes in `probes.mjs`. `core.mjs` and `elf.mjs` are exact copies
of a88. All other probe functions, validation, gates and native bytes are unchanged.
The focused tests use synthetic EventEmitter process delegates and mock timers;
they never invoke Prisma, a real child process, or a database.

The retained Prisma 5.22.0 CLI `build/index.js`, SHA256
`ff0102cdfadfecb884c5f0b6e43661f4ef2a31917dbfad3157236ba8e8532388`,
passes `-d` plus each schema path before starting the schema RPC server. The
actual failed engine log identifies revision
`605197351a3c8bdd595af2d2a9bc3025bca48ea2`. Its upstream
[CLI source](https://github.com/prisma/prisma-engines/blob/605197351a3c8bdd595af2d2a9bc3025bca48ea2/schema-engine/cli/src/main.rs)
declares short `-d` / long `--datamodels` and loads those files before creating
the RPC API. This successor supplies `--datamodels` with the exact synthetic
`schema.prisma` already written by the unchanged Prisma fixture.

A received RPC error is retained in full, followed immediately by SIGKILL of
that failed child. It never relies on stdin EOF to end an erroring server and
never retries the schema operation. The 30-second timeout remains a backstop;
later timeout or EPIPE events cannot overwrite the original failure cause.
The raw response, stdout/stderr, actual exit code/signal and invocation arguments
are retained before rejection. The same retained CLI has `stop()` call
`this.child.kill()`, whose default is SIGTERM. Therefore a successful response is
validated for executed steps, warnings and unexecutable work before requesting
SIGTERM explicitly. This does not rely on EOF. A two-second shutdown bound forces
SIGKILL and failure if necessary; the original overall timeout still applies.
The record preserves `code:null, signal:SIGTERM` for that expected shutdown and
separately marks `expectedShutdown:true` with the requested signal and reason.
It never substitutes natural exit zero. A naturally observed zero exit is still
recorded as such; other signals, nonzero exits, malformed/duplicate responses,
transport errors and forced shutdown timeouts fail. No native operation retries.

Main must independently review and pin this successor and its generated fixture
bytes. The old a88 source approval does not approve these changed bytes. The
unchanged a88 `render(plan, sources)` may bundle these three reviewed sources;
the existing exact final-image/plan bindings and all other gates remain mandatory.
Use a new exclusive observation context and retain the original timeout failure.
Do not overwrite accepted packages, previous observations or approvals. This
source patch establishes no native/runtime/hosted/release acceptance.
