import { mkdir } from "node:fs/promises";
import path from "node:path";

export async function admitOutput(args, cwd = process.cwd()) {
  if (args.length !== 2 || args[0] !== "--output-dir" || !args[1].trim()) {
    throw new Error("Usage: node run.mjs --output-dir <new-directory>; parent must already exist");
  }
  const output = path.resolve(cwd, args[1]);
  // Exclusive directory creation: even an existing empty directory is refused.
  // No recursive creation, cleanup, fallback location or evidence replacement.
  await mkdir(output);
  return output;
}
