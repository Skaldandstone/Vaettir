import { z } from "@vaettir/core/dist/validation.js";
const key = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
const legacyNetworkEvidence = z
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
export const androidHttpMethod = z.enum([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
]);
export const androidNetworkCatalog = z
  .object({
    id: key,
    revision: z.number().int().positive().max(1000000),
    routes: z
      .array(
        z
          .object({
            routeKey: key,
            method: androidHttpMethod,
            // Reviewed static vocabulary and named placeholders only. No origins,
            // queries, fragments, escapes, concrete numeric IDs or arbitrary strings.
            template: z
              .string()
              .max(180)
              .regex(
                /^\/(?:v[1-9][0-9]?\/)?(?:[a-z][a-z_-]{0,31}|\{[a-z][a-z0-9_]{0,31}\})(?:\/(?:[a-z][a-z_-]{0,31}|\{[a-z][a-z0-9_]{0,31}\})){0,7}$/,
              ),
          })
          .strict(),
      )
      .min(1)
      .max(32),
  })
  .strict()
  .refine(
    (v) => new Set(v.routes.map((r) => r.routeKey)).size === v.routes.length,
  );
const clockId = z.string().regex(/^[a-f0-9]{48}$/);
const timestamp = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER - 300000);
export const androidClockCalibration = z
  .object({
    appClockId: clockId,
    connectorClockId: clockId,
    method: z.literal("REPORTED_ROUND_TRIP_CALLBACK"),
    samples: z
      .array(
        z
          .object({
            challengeId: z.string().regex(/^[a-f0-9]{48}$/),
            sentAt: timestamp,
            appObservedAt: timestamp,
            receivedAt: timestamp,
          })
          .strict(),
      )
      .min(2)
      .max(32),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      new Set(v.samples.map((s) => s.challengeId)).size !== v.samples.length ||
      v.samples.some(
        (s, i) =>
          s.receivedAt < s.sentAt ||
          s.receivedAt - s.sentAt > 1000 ||
          (i > 0 &&
            (s.sentAt <= v.samples[i - 1]!.receivedAt ||
              s.appObservedAt <= v.samples[i - 1]!.appObservedAt)),
      ) ||
      v.samples.at(-1)!.receivedAt - v.samples[0]!.sentAt > 300000
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Require distinct, ordered, bounded actual clock observations.",
      });
  });
export const androidNetworkCorrelationApproval = z
  .object({
    catalog: androidNetworkCatalog,
    captureClock: z
      .object({ domain: z.literal("APP_REPORTED"), clockId })
      .strict(),
    sourceReviewed: z.literal(true),
    catalogReviewed: z.literal(true),
    temporalOnlyReviewed: z.literal(true),
    clockCalibration: androidClockCalibration.nullable(),
  })
  .strict();
export const androidNetworkSelection = z
  .object({
    sourceId: key,
    approvedRouteKeys: z.array(key).min(1).max(32),
    startedAt: timestamp,
    endedAt: timestamp,
    correlation: androidNetworkCorrelationApproval.optional(),
  })
  .strict();
const currentNetworkEvidence = z
  .object({
    ...legacyNetworkEvidence.shape,
    version: z.literal(2),
    catalog: androidNetworkCatalog,
    clockId,
    pendingRequests: z.number().int().min(0).max(100),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      JSON.stringify(v.catalog.routes.map((r) => r.routeKey)) !==
        JSON.stringify(v.approvedRouteKeys) ||
      v.events.some(
        (e) =>
          !v.catalog.routes.some(
            (r) => r.routeKey === e.routeKey && r.method === e.method,
          ) || (e.outcome === "RESPONSE") !== (e.status !== null),
      )
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Every event must retain its exact approved catalog operation and method.",
      });
  });
export const androidNetworkEvidence = z.union([
  legacyNetworkEvidence,
  currentNetworkEvidence,
]);
export type AndroidNetworkEvidence = z.infer<typeof androidNetworkEvidence>;
export type AndroidNetworkSelection = z.infer<typeof androidNetworkSelection>;
// No raw URL, headers, body, credentials, logs or device-wide traffic accepted.
export function admitAndroidNetworkEvidence(
  raw: unknown,
  selected: AndroidNetworkSelection & { packageName: string; runId: string },
) {
  const value = androidNetworkEvidence.parse(raw);
  const selectionInput = { ...selected };
  Reflect.deleteProperty(selectionInput, "packageName");
  Reflect.deleteProperty(selectionInput, "runId");
  const selection = androidNetworkSelection.parse(selectionInput);
  // V2 capture bounds belong to the app clock only. Host run windows remain
  // separately pinned in calibration samples and the original step receipts.
  if (
    value.version === 2 &&
    (!selection.correlation ||
      selection.correlation.captureClock.clockId !== value.clockId)
  )
    throw Error("Explicit original app clock required for capture bounds.");
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
  if (
    value.version === 2 &&
    (!selection.correlation ||
      JSON.stringify(value.catalog) !==
        JSON.stringify(selection.correlation.catalog))
  )
    throw Error(
      "The exact app source and route catalog must be independently reviewed.",
    );
  if (value.version === 1 && selection.correlation)
    throw Error(
      "Legacy evidence cannot be upgraded to catalog or timing proof.",
    );
  return value;
}
