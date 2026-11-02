import { z } from "@vaettir/core/dist/validation.js";
const key = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
export const androidNetworkEvidence = z
  .object({
    version: z.literal(1),
    capability: z.literal("DEBUG_APP_HTTP_CALLBACKS"),
    debugBuild: z.literal(true),
    metadataOnly: z.literal(true),
    packageName: z
      .string()
      .regex(/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+$/)
      .max(200),
    runId: z.string().regex(/^[a-f0-9]{48}$/),
    sourceId: key,
    approvedRouteKeys: z.array(key).min(1).max(32),
    events: z
      .array(
        z
          .object({
            routeKey: key,
            method: z.enum([
              "GET",
              "HEAD",
              "POST",
              "PUT",
              "PATCH",
              "DELETE",
              "OPTIONS",
            ]),
            status: z.number().int().min(100).max(599).nullable(),
            startedAt: z.number().int().nonnegative(),
            durationMs: z.number().int().min(0).max(300000),
            outcome: z.enum(["RESPONSE", "TRANSPORT_ERROR"]),
          })
          .strict(),
      )
      .max(100),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      new Set(v.approvedRouteKeys).size !== v.approvedRouteKeys.length ||
      v.events.some(
        (e) =>
          !v.approvedRouteKeys.includes(e.routeKey) ||
          (e.outcome === "RESPONSE") !== (e.status !== null),
      )
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Every event must match the explicitly approved symbolic route and outcome.",
      });
  });
// No raw URL, headers, body, credentials, logs or device-wide traffic accepted.
export function admitAndroidNetworkEvidence(
  raw: unknown,
  selected: {
    packageName: string;
    runId: string;
    sourceId: string;
    approvedRouteKeys: string[];
    startedAt: number;
    endedAt: number;
  },
) {
  const value = androidNetworkEvidence.parse(raw);
  if (
    !Number.isSafeInteger(selected.startedAt) ||
    !Number.isSafeInteger(selected.endedAt) ||
    selected.endedAt < selected.startedAt ||
    selected.endedAt - selected.startedAt > 300000 ||
    value.packageName !== selected.packageName ||
    value.runId !== selected.runId ||
    value.sourceId !== selected.sourceId ||
    JSON.stringify(value.approvedRouteKeys) !==
      JSON.stringify(selected.approvedRouteKeys) ||
    value.events.some(
      (e) =>
        e.startedAt < selected.startedAt ||
        e.startedAt + e.durationMs > selected.endedAt,
    )
  )
    throw Error(
      "App, run, approved source, route selection or capture interval changed.",
    );
  return value;
}
