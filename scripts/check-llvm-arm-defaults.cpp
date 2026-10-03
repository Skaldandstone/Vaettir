// Author-created, fixed-input policy probe for Debian LLVM 19.1.7-3.
// This tests target parsing on the builder CPU, not execution on ARM hardware.
// The maintained quilt series intentionally changes the unspecified soft/hard
// ARM CPU defaults. Explicit targets and invalid spellings must stay unchanged.
#include "llvm/TargetParser/ARMTargetParser.h"
#include "llvm/TargetParser/Triple.h"

#include <cstddef>
#include <cstdio>

struct PolicyCase {
  const char *triple;
  const char *march;
  const char *expected;
};

static constexpr PolicyCase policy[] = {
    {"arm--nacl", "", "cortex-a8"},
    {"arm--openbsd", "", "cortex-a8"},
    {"armv6-unknown-freebsd", "", "arm1176jzf-s"},
    {"thumbv6-unknown-freebsd", "", "arm1176jzf-s"},
    {"armebv6-unknown-freebsd", "", "arm1176jzf-s"},
    {"arm--win32", "", "cortex-a9"},
    {"arm--win32", "armv8-a", "generic"},
    {"armv7k-apple-ios9", "", "cortex-a7"},
    {"armv7k-apple-watchos3", "", "cortex-a7"},
    {"armv7k-apple-tvos9", "", "cortex-a7"},
    {"armeb-none-eabi", "", "arm926ej-s"},
    {"armebeb-none-eabi", "", ""},
    {"armebv6eb-none-eabi", "", ""},
    {"xscaleeb-none-eabi", "", "xscale"},
    {"armebxscale-none-eabi", "", ""},
    {"arm-none-eabi", "", "arm926ej-s"},
    {"arm-unknown-linux-gnueabi", "", "arm926ej-s"},
    {"armeb-unknown-linux-gnueabi", "", "arm926ej-s"},
    {"arm-none-eabihf", "", "cortex-a8"},
    {"thumb-none-eabihf", "", "cortex-a8"},
    {"armeb-none-eabihf", "", "cortex-a8"},
    {"arm-unknown-linux-gnueabihf", "", "cortex-a8"},
    {"thumb-unknown-linux-gnueabihf", "", "cortex-a8"},
    {"armeb-unknown-linux-gnueabihf", "", "cortex-a8"},
    {"arm-unknown-linux-gnueabihft64", "", "cortex-a8"},
    {"thumb-unknown-linux-gnueabihft64", "", "cortex-a8"},
    {"armeb-unknown-linux-gnueabihft64", "", "cortex-a8"},
    {"arm-unknown-linux-musleabihf", "", "cortex-a8"},
    {"thumb-unknown-linux-musleabihf", "", "cortex-a8"},
    {"armeb-unknown-linux-musleabihf", "", "cortex-a8"},
};

static constexpr std::size_t policyCount = sizeof(policy) / sizeof(policy[0]);
static_assert(policyCount == 30, "Every frozen policy vector must be retained");

int main() {
  // Emit no success receipt until every exact baseline-policy assertion passed.
  for (const PolicyCase &entry : policy) {
    const llvm::Triple triple(entry.triple);
    const llvm::StringRef actual =
        llvm::ARM::getARMCPUForArch(triple, entry.march);
    if (actual != entry.expected) {
      std::fprintf(stderr, "LLVM ARM policy mismatch: %s march=%s expected=%s\n",
                   entry.triple, entry.march, entry.expected);
      return 1;
    }
  }
  for (const PolicyCase &entry : policy)
    std::printf("VAETTIR_LLVM_ARM_POLICY %s march=%s cpu=%s\n", entry.triple,
                entry.march, entry.expected);
  std::printf("VAETTIR_LLVM_ARM_POLICY_VECTORS=%zu\n", policyCount);
  return 0;
}
