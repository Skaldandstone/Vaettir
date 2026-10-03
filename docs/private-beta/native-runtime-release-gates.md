# Native runtime release gates

These are implementation and validation contracts, not a deployment or whole-product security certification.

## Image processing

Next's actual Sharp dependency resolves to the maintained Sharp0.35.5/native-addon0.35.5/libvips-package1.3.4 combination. The published bundle contains libvips8.18.7, XML2.15.4 and Expat2.8.5. Upgrade the matching maintained packages together, not an incompatible DSO under an older addon.

The offline final-image guard checks actual loaded versions and exact authored PNG, lossless WebP and SVG pixels. It accepts no customer input. Per-operation timeouts and pixel limits bound the fixtures. CI also executes the installed image-processing guard. Final artifact review must tie the bundled DSO to the integrity-verified published package; OS-package scanning alone does not cover statically embedded libraries.

Primary references: [Sharp0.35.5](https://github.com/lovell/sharp/releases/tag/v0.35.5), [libvips package1.3.4](https://github.com/lovell/sharp-libvips/releases/tag/v1.3.4).

## LLVM and Mesa compatibility

The signed maintained LLVM19 source rebuild disables only the supported optional Windows-manifest XML integration. All existing targets and Polly remain configured. Assertions remain enabled; the actual CMake input is `LLVM_ABI_BREAKING_CHECKS=FORCE_OFF`, not `LLVM_ENABLE_ABI_BREAKING_CHECKS`. Before compilation, both the cache and generated header must confirm the intended ABI configuration.

Exact SONAME, all baseline exports, data/TLS storage and remaining shared dependencies must match before honest package generation. The final image checks package ownership, installed library hashes, Mesa/LLVM/JIT loader relocations, exact LLVM resolution and an authored fixed-input native integer JIT. No builder RPATH, substituted runtime library or inherited credential/loader environment is allowed.

This proves shared-library loading and CPU code generation, not Mesa shader rendering, console/device acceptance or selection of a particular Chromium renderer. Chromium's default headless renderer may use SwiftShader; a browser pixel check alone is not proof of Mesa/LLVM execution.

Primary reference: [LLVM19 CMake ABI configuration](https://releases.llvm.org/19.1.0/docs/CMake.html#llvm-related-variables).

## Release evidence

Retain signed-source and patch identities, native build/test receipts, exact commit/digests, compatible migration rehearsals, recovery definitions, unsuppressed scans and authenticated runtime checks separately. A component-specific non-applicability finding must cite its exact shipped code and upstream affected scope; it is not a blanket waiver for consumers or embedded dependencies. Any failed security, data-integrity or runtime check requires diagnosis and a scoped correction before rollout.
