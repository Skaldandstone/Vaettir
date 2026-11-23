# OpenSSL runtime backport

The isolated proof rebuilds signed Debian OpenSSL3.5.9-1~deb13u1 with the exact upstream fixes and regression tests listed in openssl-runtime-sources.json. The local package version remains3.5.9-1~deb13u1+vaettir1; it does not impersonate the unreleased3.5.10 package.

Sources are the Debian signed source descriptor and OpenSSL's published3.5 fixes, branch commits and the reviewed DANE fix PR33634 at its pinned head. Original patch bytes are hashed before use. One DANE patch needs a context-only formatting adjustment for3.5's existing long condition. That adjustment has its own hash and must preserve every upstream added and removed line exactly. Patch application still uses zero fuzz.

The proof requires Debian's complete package build/tests and retains their log. It then checks installed-baseline symbol coverage, library SONAMEs and exact package identities before exporting packages and receipts. It does not disable tests, algorithms, TLS checks or provider permissions.

This target is source proof only. It neither changes application runtime images nor authorizes deployment or scanner suppression. Final image identity, installed-library checks, application tests and scan review remain separate release requirements.

Primary sources:
- https://openssl-library.org/news/vulnerabilities-3.5/
- https://github.com/openssl/openssl/tree/openssl-3.5
- https://github.com/openssl/openssl/pull/33634
- https://github.com/openssl/openssl/pull/33546
- https://github.com/openssl/openssl/pull/33544
- https://deb.debian.org/debian/pool/main/o/openssl/
