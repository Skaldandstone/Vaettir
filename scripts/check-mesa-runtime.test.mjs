import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  checkMesaRuntime,
  mesaChildEnvironment,
  parseInstalledPackage,
  galliumPackagePath,
  verifyLoaderOutput,
} from "./check-mesa-runtime.mjs";

const llvm = "/usr/lib/x86_64-linux-gnu/libLLVM.so.19.1";
const mesa = "/usr/lib/x86_64-linux-gnu/libgallium-25.0.7-2+deb13u1.so";
const receiptPath = "/usr/share/vaettir/llvm-abi.json";
const jit = "/usr/share/vaettir/llvm-cpu-jit";
const sha = "a".repeat(64);
const receipt = {
  soname: "libLLVM.so.19.1",
  packageVersion: "1:19.1.7-3+vaettir1",
  candidateSha256: sha,
};
const loader = (withLLVM = false) =>
  `\tlinux-vdso.so.1 (0x0000)\n${withLLVM ? `\tlibLLVM.so.19.1 => ${llvm} (0x1234)\n` : ""}\tlibc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x2345)\n\t/lib64/ld-linux-x86-64.so.2 (0x3456)\n`;

function fixture(override = {}) {
  const calls = [];
  return {
    calls,
    options: {
      readFileImpl: async (path) => {
        assert.equal(path, receiptPath);
        return JSON.stringify(receipt);
      },
      realpathImpl: async (path) => path,
      hashFileImpl: async (path) => {
        assert.equal(path, llvm);
        return sha;
      },
      runImpl: async (command, args, options) => {
        calls.push({ command, args, options });
        assert.deepEqual(options.env, {
          PATH: "/usr/bin:/bin",
          LANG: "C",
          LC_ALL: "C",
        });
        assert.equal(options.timeout, 15_000);
        assert.equal(options.killSignal, "SIGKILL");
        assert.equal(options.maxBuffer, 256 * 1024);
        if (override.run) {
          const result = await override.run(command, args);
          if (result) return result;
        }
        let stdout;
        if (command === "/usr/bin/dpkg-query" && args[0] === "-W")
          stdout = `ii \t${args.at(-1) === "libllvm19" ? receipt.packageVersion : "25.0.7-2+deb13u1"}\tamd64`;
        else if (command === "/usr/bin/dpkg-query" && args[0] === "-L")
          stdout =
            args[1] === "libllvm19" ? `${llvm}\n${receiptPath}\n` : `${mesa}\n`;
        else if (command === "/usr/bin/ldd") stdout = loader(args[1] !== llvm);
        else if (command === jit) {
          assert.deepEqual(args, []);
          stdout = "VAETTIR_LLVM_CPU_JIT_ADD_4_7=11\n";
        } else throw new Error("Unexpected synthetic command");
        return { stdout, stderr: "" };
      },
      ...override.options,
    },
  };
}

test("installed package, stripped receipt/hash, loader and authored CPU JIT checks are separate and honest", async () => {
  const { options, calls } = fixture();
  const proof = await checkMesaRuntime(options);
  assert.equal(proof.llvm.sha256, sha);
  assert.equal(proof.mesa.version, "25.0.7-2+deb13u1");
  assert.equal(proof.loaderChecks.length, 3);
  assert.match(proof.scope, /not Mesa rendering/);
  assert.deepEqual(
    calls
      .filter((call) => call.command === "/usr/bin/ldd")
      .map((call) => call.args),
    [
      ["-r", llvm],
      ["-r", mesa],
      ["-r", jit],
    ],
  );
  assert.equal(calls.at(-1).command, jit);
});

test("child environment excludes caller credentials, LD injection, proxies and PATH substitution", () => {
  assert.deepEqual(
    mesaChildEnvironment({
      PATH: "injected",
      LD_PRELOAD: "bad",
      LD_LIBRARY_PATH: "bad",
      DATABASE_URL: "private",
      AWS_SECRET_ACCESS_KEY: "private",
      HTTP_PROXY: "private",
      NODE_OPTIONS: "bad",
    }),
    { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" },
  );
});

test("package and owned DSO discovery reject uninstalled, wrong architecture, malformed and multiple identities", () => {
  assert.equal(
    parseInstalledPackage("ii \t25.0.7-2+deb13u1\tamd64\n", "mesa"),
    "25.0.7-2+deb13u1",
  );
  for (const bad of [
    "rc \t19.1.7\tamd64",
    "ii \t19.1.7\tarm64",
    "ii \t19.1.7\tamd64\textra",
    "ii \t\tamd64",
  ])
    assert.throws(() => parseInstalledPackage(bad, "llvm"), /invalid/);
  assert.equal(galliumPackagePath(`/usr/share/doc/mesa\n${mesa}\n`), mesa);
  for (const bad of [
    "",
    "/tmp/libgallium-25.so",
    `${mesa}\n${mesa}`,
    "/usr/lib/x86_64-linux-gnu/libgallium-../../evil.so",
  ])
    assert.throws(() => galliumPackagePath(bad), /Expected one/);
});

test("ldd relocation output rejects missing DSOs, unresolved symbols, static or unrecognized output", () => {
  assert.equal(verifyLoaderOutput(loader(true)).get("libLLVM.so.19.1"), llvm);
  for (const [stdout, stderr] of [
    ["libLLVM.so.19.1 => not found", ""],
    [loader(), "undefined symbol: LLVMExample"],
    ["statically linked", ""],
    [loader() + "unknown output", ""],
    ["", ""],
    [loader() + loader(), ""],
  ])
    assert.throws(() => verifyLoaderOutput(stdout, stderr));
});

test("receipt/hash/package/ownership mismatch prevents all JIT execution", async () => {
  const failures = [
    { options: { hashFileImpl: async () => "b".repeat(64) } },
    {
      options: {
        readFileImpl: async () =>
          JSON.stringify({ ...receipt, packageVersion: "19.1.7" }),
      },
    },
    { options: { readFileImpl: async () => "x".repeat(65 * 1024) } },
    { options: { readFileImpl: async () => "{}" } },
    {
      options: {
        realpathImpl: async (path) => (path === llvm ? "/tmp/otherLLVM" : path),
      },
    },
    {
      run: async (command, args) =>
        command.endsWith("dpkg-query") &&
        args[0] === "-W" &&
        args.at(-1) === "libllvm19"
          ? { stdout: "ii \t1:19.1.7-3+b1\tamd64", stderr: "" }
          : null,
    },
    {
      run: async (command, args) =>
        command.endsWith("dpkg-query") &&
        args[0] === "-L" &&
        args[1] === "libllvm19"
          ? { stdout: llvm, stderr: "" }
          : null,
    },
    {
      run: async (command, args) =>
        command.endsWith("dpkg-query") &&
        args[0] === "-W" &&
        args.at(-1) === "mesa-libgallium"
          ? { stdout: "ii \t25.0.8-1\tamd64", stderr: "" }
          : null,
    },
  ];
  for (const failure of failures) {
    const { options, calls } = fixture(failure);
    await assert.rejects(checkMesaRuntime(options));
    assert.equal(
      calls.some((call) => call.command === jit),
      false,
    );
  }
});

test("Mesa and JIT must resolve the exact installed LLVM rather than another or absent library", async () => {
  for (const target of [mesa, jit])
    for (const output of [
      loader(false),
      loader(true).replace(llvm, "/tmp/alternate.so"),
    ]) {
      const { options, calls } = fixture({
        run: async (command, args) =>
          command.endsWith("ldd") && args[1] === target
            ? { stdout: output, stderr: "" }
            : null,
      });
      await assert.rejects(
        checkMesaRuntime(options),
        /verified installed LLVM/,
      );
      assert.equal(
        calls.some((call) => call.command === jit),
        false,
      );
    }
});

test("command failure, timeout and abort retain the exact primary error; no later CPU execution", async () => {
  for (const primary of [
    new Error("loader exit failure"),
    Object.assign(new Error("deadline"), { killed: true }),
    Object.assign(new Error("cancelled"), { name: "AbortError" }),
  ]) {
    const { options, calls } = fixture({
      run: async (command) => {
        if (command.endsWith("ldd")) throw primary;
      },
    });
    await assert.rejects(
      checkMesaRuntime(options),
      (error) => error === primary,
    );
    assert.equal(
      calls.some((call) => call.command === jit),
      false,
    );
  }
  const controller = new AbortController();
  controller.abort();
  const { options, calls } = fixture({
    options: { signal: controller.signal },
  });
  await assert.rejects(checkMesaRuntime(options), { name: "AbortError" });
  assert.equal(calls.length, 0);
});

test("authored JIT success requires exact expected value and no diagnostics", async () => {
  for (const result of [
    { stdout: "VAETTIR_LLVM_CPU_JIT_ADD_4_7=12", stderr: "" },
    {
      stdout: "VAETTIR_LLVM_CPU_JIT_ADD_4_7=11",
      stderr: "materialization failed",
    },
  ]) {
    const { options } = fixture({
      run: async (command) => (command === jit ? result : null),
    });
    await assert.rejects(checkMesaRuntime(options), /result mismatch/);
  }
});

test("C fixture uses documented fixed MCJIT/native API, no input parsing or external source", () => {
  const source = readFileSync(
    new URL("./check-llvm-jit.c", import.meta.url),
    "utf8",
  );
  assert.match(source, /int main\(void\)/);
  assert.match(source, /LLVMInitializeNativeTarget\(\)/);
  assert.match(source, /LLVMInitializeNativeAsmPrinter\(\)/);
  assert.match(source, /LLVMVerifyModule\(module, LLVMReturnStatusAction/);
  assert.match(
    source,
    /LLVMCreateMCJITCompilerForModule\(&engine, transferred/,
  );
  assert.match(source, /LLVMGetFunctionAddress\(engine, "vaettir_add"\)/);
  assert.match(source, /add\(4, 7\) != 11/);
  assert.doesNotMatch(source, /getenv|fopen|scanf|argv|LLVMParseIR|system\(/);
});
