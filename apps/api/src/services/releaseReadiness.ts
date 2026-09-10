import * as Sentry from "@sentry/node";
import type { PrismaClient } from "@vaettir/db";
import { computeStatusesByTestPlan } from "./acceptanceCriteria.js";
import { computeReadiness, type Readiness } from "./orgReadiness.js";
import { dispatchWebhookEvent } from "./webhookDelivery.js";
import { notifySlackEvent } from "./slackEventNotify.js";
import { sendPushToUser } from "./pushNotify.js";

// P8-04 (second half): release readiness has always been computed live
// from current criteria + open risk flags and never persisted, so there
// was no such thing as a readiness "change" to notify on. This service is
// that missing piece: it computes readiness exactly the way the
// releases.readiness query does (one shared function, so the page, the
// snapshot history and the notification can never disagree), keeps a
// snapshot row whenever the score or label moves, and fires the three
// existing notification channels - outbound webhooks (P9-06), Slack
// (P9-03) and mobile push (P8-04) - only when the *label* changes.
// Score wobble inside the same label is recorded (it's real history) but
// deliberately not announced: a release drifting 82 -> 79 is not news,
// AT_RISK -> BLOCKED is.

export async function computeReleaseReadiness(prisma: PrismaClient, releaseId: string): Promise<Readiness> {
  const criteria = await prisma.acceptanceCriterion.findMany({
    where: { testPlan: { releaseId } },
    select: { testPlanId: true, status: true },
  });
  const computedByPlan = await computeStatusesByTestPlan(
    prisma,
    criteria.map((c) => c.testPlanId),
  );
  const openFlags = await prisma.riskFlag.findMany({
    where: { releaseId, resolvedAt: null },
    select: { severity: true },
  });
  return computeReadiness(
    criteria.map((c) => ({ status: computedByPlan.get(c.testPlanId) ?? c.status })),
    openFlags,
  );
}

export type ReadinessTransition = "baseline" | "unchanged" | "score_changed" | "label_changed";

// Pure so it can be unit-tested without a database: what kind of change
// is this snapshot relative to the previous one? "baseline" is the very
// first snapshot for a release - recorded, never announced, since there is
// nothing it changed *from*.
export function classifyReadinessTransition(
  previous: { score: number; label: string } | null,
  next: { score: number; label: string },
): ReadinessTransition {
  if (!previous) return "baseline";
  if (previous.label !== next.label) return "label_changed";
  if (previous.score !== next.score) return "score_changed";
  return "unchanged";
}

export interface ReadinessChangedEvent {
  organizationId: string;
  projectId: string;
  projectName: string;
  releaseId: string;
  releaseName: string;
  previousLabel: string;
  label: string;
  previousScore: number;
  score: number;
  criteria: Readiness["criteria"];
  riskFlags: Readiness["riskFlags"];
}

// Every channel is attempted even if one fails; failures are reported to
// Sentry, never thrown, matching the fire-and-forget contract those
// channels already have at their other call sites. Awaited (not `void`ed)
// so the scheduler - and the integration test - know when it's done.
export async function notifyReadinessChanged(prisma: PrismaClient, event: ReadinessChangedEvent): Promise<void> {
  const members = await prisma.membership.findMany({
    where: { organizationId: event.organizationId },
    select: { userId: true },
  });
  const pushBody = `${event.projectName}: readiness went ${event.previousLabel} → ${event.label} (score ${event.previousScore} → ${event.score})`;

  const attempts: Promise<unknown>[] = [
    dispatchWebhookEvent(prisma, event.organizationId, "release.readiness_changed", {
      projectId: event.projectId,
      projectName: event.projectName,
      releaseId: event.releaseId,
      releaseName: event.releaseName,
      previousLabel: event.previousLabel,
      label: event.label,
      previousScore: event.previousScore,
      score: event.score,
      criteria: event.criteria,
      riskFlags: event.riskFlags,
    }),
    notifySlackEvent(prisma, event.organizationId, "release.readiness_changed", {
      projectName: event.projectName,
      releaseName: event.releaseName,
      previousLabel: event.previousLabel,
      label: event.label,
      previousScore: event.previousScore,
      score: event.score,
    }),
    ...members.map((m) =>
      sendPushToUser(prisma, m.userId, {
        title: `${event.releaseName} is now ${event.label.replace("_", " ")}`,
        body: pushBody,
        data: { type: "release.readiness_changed", releaseId: event.releaseId, projectId: event.projectId },
      }),
    ),
  ];
  const results = await Promise.allSettled(attempts);
  for (const r of results) {
    if (r.status === "rejected") Sentry.captureException(r.reason);
  }
}

// Fire-and-forget refresh for the mutations that can move readiness
// (risk flag create/resolve, acceptance-criterion edits, plan attach/
// detach, test-result ingestion). The 5-minute sweep remains the safety
// net; these make a label change notify within seconds of the action
// that caused it instead of "sometime in the next five minutes". Never
// awaited by the mutation - a notification hiccup must not fail the edit.
export function refreshReleaseReadiness(prisma: PrismaClient, releaseId: string | null | undefined): void {
  if (!releaseId) return;
  void recordReadinessSnapshot(prisma, releaseId).catch((e) => Sentry.captureException(e));
}

export function refreshProjectReadiness(prisma: PrismaClient, projectId: string): void {
  void prisma.release
    .findMany({ where: { projectId, status: { not: "SHIPPED" } }, select: { id: true } })
    .then((releases) => Promise.all(releases.map((r) => recordReadinessSnapshot(prisma, r.id))))
    .catch((e) => Sentry.captureException(e));
}

export interface RecordReadinessResult {
  transition: ReadinessTransition;
  readiness: Readiness;
  previous: { score: number; label: string } | null;
}

// The one entry point the scheduler calls per active release. Idempotent
// on unchanged readiness (no row, no notification), so a 5-minute tick
// against a quiet release costs three reads and nothing else.
export async function recordReadinessSnapshot(
  prisma: PrismaClient,
  releaseId: string,
  options: { notify?: boolean } = {},
): Promise<RecordReadinessResult> {
  const release = await prisma.release.findUniqueOrThrow({
    where: { id: releaseId },
    include: { project: { select: { id: true, name: true, organizationId: true } } },
  });
  const readiness = await computeReleaseReadiness(prisma, releaseId);
  const previous = await prisma.releaseReadinessSnapshot.findFirst({
    where: { releaseId },
    orderBy: { computedAt: "desc" },
    select: { score: true, label: true },
  });
  const transition = classifyReadinessTransition(previous, readiness);
  if (transition === "unchanged") return { transition, readiness, previous };

  await prisma.releaseReadinessSnapshot.create({
    data: {
      releaseId,
      score: readiness.score,
      label: readiness.label,
      previousLabel: previous?.label ?? null,
      criteriaMet: readiness.criteria.met,
      criteriaTotal: readiness.criteria.total,
      openRiskFlags: readiness.riskFlags.openTotal,
    },
  });

  if (transition === "label_changed" && options.notify !== false && previous) {
    await notifyReadinessChanged(prisma, {
      organizationId: release.project.organizationId,
      projectId: release.project.id,
      projectName: release.project.name,
      releaseId,
      releaseName: release.name,
      previousLabel: previous.label,
      label: readiness.label,
      previousScore: previous.score,
      score: readiness.score,
      criteria: readiness.criteria,
      riskFlags: readiness.riskFlags,
    });
  }
  return { transition, readiness, previous };
}
