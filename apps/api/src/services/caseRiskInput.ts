import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";

export type CaseRiskInputSource = {
  title: string;
  given: string[];
  when: string[];
  then: string[];
  testType: string;
  source?: { filePath: string } | null;
};

/** Exact legacy risk-input/cache identity. Property order, array contents and
 * absent source -> NULL are intentional paid-cache compatibility boundaries.
 * No new procedure/source-code/provider context is inferred or forwarded. */
export function buildCaseRiskInput(tc: CaseRiskInputSource) {
  const data = {
    title: tc.title,
    given: tc.given,
    when: tc.when,
    then: tc.then,
    testType: tc.testType,
    sourceFilePath: tc.source?.filePath ?? null,
  };
  const serialized = JSON.stringify(data);
  if (Buffer.byteLength(serialized, "utf8") > 64_000)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "This case exceeds the risk review size limit. Split it into focused cases before reviewing.",
    });
  return { data, hash: createHash("sha256").update(serialized).digest("hex") };
}
