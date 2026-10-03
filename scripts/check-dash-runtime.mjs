import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const execute = promisify(execFile);
export function importsLibcFnmatch(binary) {
  if (
    !Buffer.isBuffer(binary) ||
    binary.length < 64 ||
    binary.length > 4_000_000 ||
    binary.subarray(0, 4).toString("hex") !== "7f454c46" ||
    binary[4] !== 2 ||
    binary[5] !== 1
  )
    throw Error("Expected bounded Linux ELF64 little-endian Dash executable");
  const integer = (offset) => {
    if (offset < 0 || offset + 8 > binary.length)
      throw Error("ELF offset unavailable");
    const value = Number(binary.readBigUInt64LE(offset));
    if (!Number.isSafeInteger(value)) throw Error("ELF offset exceeds bounds");
    return value;
  };
  const offset = integer(40),
    size = binary.readUInt16LE(58),
    count = binary.readUInt16LE(60);
  if (
    size !== 64 ||
    count < 1 ||
    count > 256 ||
    offset + size * count > binary.length
  )
    throw Error("ELF section table exceeds bounds");
  const sections = Array.from({ length: count }, (_, index) => {
    const position = offset + size * index;
    return {
      type: binary.readUInt32LE(position + 4),
      offset: integer(position + 24),
      size: integer(position + 32),
      link: binary.readUInt32LE(position + 40),
      entry: integer(position + 56),
    };
  });
  for (const symbols of sections.filter((section) => section.type === 11)) {
    const strings = sections[symbols.link];
    if (
      !strings ||
      strings.type !== 3 ||
      symbols.entry !== 24 ||
      symbols.size % 24 !== 0 ||
      symbols.offset + symbols.size > binary.length ||
      strings.offset + strings.size > binary.length
    )
      throw Error("ELF imported symbol table exceeds bounds");
    for (
      let position = symbols.offset;
      position < symbols.offset + symbols.size;
      position += 24
    ) {
      if (binary.readUInt16LE(position + 6) !== 0) continue;
      const nameOffset = binary.readUInt32LE(position);
      if (nameOffset >= strings.size)
        throw Error("ELF symbol string exceeds bounds");
      const start = strings.offset + nameOffset,
        end = binary.indexOf(0, start);
      if (
        end < start ||
        end >= strings.offset + strings.size ||
        end - start > 1024
      )
        throw Error("ELF symbol string is not bounded");
      if (binary.subarray(start, end).toString("ascii") === "fnmatch")
        return true;
    }
  }
  return false;
}
export function dashChildEnvironment(env, home, locale) {
  return {
    PATH: typeof env.PATH === "string" ? env.PATH : "/usr/bin:/bin",
    HOME: home,
    TMPDIR: home,
    LANG: locale,
    LC_ALL: locale,
  };
}
export const patternFixture = `
case 'a5' in [[:alpha:]][[:digit:]]) : ;; *) exit 11 ;; esac
case 'z' in [!a-c]) : ;; *) exit 12 ;; esac
case 'a*b' in 'a*b') : ;; *) exit 13 ;; esac
case 'é*' in 'é*') : ;; *) exit 14 ;; esac
case '' in *) : ;; esac
v='prefix*mid suffix'
[ "\${v#'prefix*'}" = 'mid suffix' ] || exit 15
[ "\${v% suffix}" = 'prefix*mid' ] || exit 16
v='root/a.txt'
[ "\${v##*/}" = 'a.txt' ] || exit 17
cd "$1" || exit 18
set -- *.txt
[ "$#" = 3 ] && [ "$1" = a.txt ] && [ "$2" = b.txt ] && [ "$3" = 'space name.txt' ] || exit 19
set -- "*.txt"
[ "$#" = 1 ] && [ "$1" = '*.txt' ] || exit 20
printf '%s\\n' pattern-semantics-verified
`;
const adversePattern = "*.*.*.*.*.*.*.*.*.tar.gz";
const adverseCase = `case "$1" in ${adversePattern}) exit 21 ;; *) printf '%s\\n' bounded-case-verified ;; esac`;
const adverseGlob = `cd "$1" || exit 22; pattern='${adversePattern}'; set -- $pattern; [ "$#" = 1 ] && [ "$1" = "$pattern" ] || exit 23; printf '%s\\n' bounded-glob-verified`;
async function run(command, args, options) {
  const result = await execute(command, args, options);
  return { code: 0, stdout: result.stdout };
}
export async function checkDashRuntime({
  env = process.env,
  signal,
  binaryPath = "/bin/dash",
  runImpl = run,
  readFileImpl = readFile,
} = {}) {
  signal?.throwIfAborted();
  const binary = await readFileImpl(binaryPath);
  if (!importsLibcFnmatch(binary))
    throw Error(
      "Dash does not import libc fnmatch; internal matcher remains unverified",
    );
  const root = await mkdtemp(join(tmpdir(), "vaettir-dash-runtime-"));
  try {
    for (const name of [
      "a.txt",
      "b.txt",
      "space name.txt",
      ".hidden.txt",
      "a.".repeat(60) + "tar.gx",
    ])
      await writeFile(join(root, name), "", { flag: "wx" });
    const checked = async (script, args, expected, locale, timeout = 3000) => {
      signal?.throwIfAborted();
      const result = await runImpl(
        binaryPath,
        ["-c", script, "vaettir-dash-fixture", ...args],
        {
          env: dashChildEnvironment(env, root, locale),
          cwd: root,
          timeout,
          maxBuffer: 4096,
          killSignal: "SIGKILL",
          signal,
        },
      );
      if (result.code !== 0 || result.stdout?.trim() !== expected)
        throw Error("Dash pattern or locale regression failed");
    };
    for (const locale of ["C", "C.UTF-8"])
      await checked(
        patternFixture,
        [root],
        "pattern-semantics-verified",
        locale,
      );
    await checked(
      adverseCase,
      ["a.".repeat(60) + "tar.gx"],
      "bounded-case-verified",
      "C",
      1500,
    );
    await checked(adverseGlob, [root], "bounded-glob-verified", "C", 1500);
    return {
      sha256: createHash("sha256").update(binary).digest("hex"),
      imported: "fnmatch",
      locales: ["C", "C.UTF-8"],
      checks: 4,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  const deadline = setTimeout(() => process.exit(1), 20_000);
  try {
    const proof = await checkDashRuntime({
      signal: controller.signal,
      ...(process.argv[2] ? { binaryPath: process.argv[2] } : {}),
    });
    console.log(`Dash libc fnmatch runtime verified: ${JSON.stringify(proof)}`);
  } catch {
    console.error(
      "Dash runtime verification failed; no customer files or credentials were used.",
    );
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}
