import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@vaettir/db";
import { TRPCError } from "@trpc/server";
import { lockedProcessingEditor } from "./repositoryProcessingApproval.js";
import { assertPublicHttpUrl } from "./urlGuard.js";

export function reportDestinationHash(url: string) {
  return createHash("sha256").update(url).digest("hex");
}
export function requireReportSlackDestination(raw: string | null) {
  try {
    const url = new URL(raw ?? "");
    if (
      url.protocol !== "https:" ||
      !["hooks.slack.com", "hooks.slack-gov.com"].includes(url.hostname) ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/services\/[^/]+\/[^/]+\/[^/]+$/.test(url.pathname)
    )
      throw Error();
    return url.toString();
  } catch {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "A supported workspace Slack destination must already be configured.",
    });
  }
}
const count = z.number().int().nonnegative();
const source = z.object({
  asOf: z.string(),
  projectName: z.string(),
  windowStart: z.string(),
  windowEnd: z.string().optional(),
  scope: z.object({ kind: z.string() }).optional(),
  definition: z.object({ sections: z.array(z.string()) }),
  inventory: z.object({ active: count }),
  execution: z.object({
    runs: count,
    results: count,
    outcomes: z
      .array(
        z.object({
          key: z.enum(["PASS", "FAIL", "SKIP", "FLAKY", "BLOCKED"]),
          count,
        }),
      )
      .max(5),
  }),
});
/** Explicit recurring aggregate mandate only. No report title, author narrative,
 * case content, personal identifiers, attachment or share token is delivered. */
export function reportDeliveryPayload(raw: unknown) {
  const report = source.parse(raw),
    lines = [
      `Captured ${report.asOf}`,
      `Run-start window: ${report.windowStart} to ${report.windowEnd ?? report.asOf}`,
      report.scope && report.scope.kind !== "project"
        ? "Selected execution scope; see the private capture for the exact selection."
        : "Project-wide execution scope.",
    ];
  if (report.definition.sections.includes("inventory"))
    lines.push(`Active cases: ${report.inventory.active}`);
  if (report.definition.sections.includes("execution")) {
    lines.push(
      `Runs: ${report.execution.runs}; recorded results: ${report.execution.results}`,
    );
    for (const bucket of report.execution.outcomes)
      lines.push(`${bucket.key}: ${bucket.count}`);
  }
  lines.push(
    "Automated aggregate capture; not an approved release decision. Repeated observations count separately. No result is not a pass. Review the private capture in Vaettir for scope and limitations.",
  );
  return {
    text: "Scheduled Vaettir quality report",
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Scheduled quality report" },
      },
      {
        type: "section",
        text: { type: "plain_text", text: report.projectName.slice(0, 1000) },
      },
      {
        type: "section",
        text: { type: "plain_text", text: lines.join("\n").slice(0, 2900) },
      },
    ],
  };
}
type Send = (
  url: string,
  payload: ReturnType<typeof reportDeliveryPayload>,
  deadline: number,
) => Promise<void>;
export async function postReport(
  url: string,
  payload: ReturnType<typeof reportDeliveryPayload>,
  deadline: number,
) {
  requireReportSlackDestination(url);
  if (Date.now() >= deadline)
    throw new Error("Delivery authorization window expired");
  let timer: ReturnType<typeof setTimeout> | undefined;
  // A stalled DNS check must never resume dispatch after transaction locks expire.
  const target = await Promise.race([
    assertPublicHttpUrl(url),
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("Delivery destination check timed out")),
        Math.min(2000, deadline - Date.now()),
      );
    }),
  ]).finally(() => clearTimeout(timer));
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Delivery authorization window expired");
  const response = await fetch(target, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(Math.min(5000, remaining)),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  void response.body?.cancel().catch(() => {});
  if (!response.ok) throw new Error("Report delivery outcome is unknown");
}
async function deliveryAuthority(
  tx: Prisma.TransactionClient,
  scheduleId: string,
  version: number,
) {
  const candidate = await tx.projectReportSchedule.findUniqueOrThrow({
    where: { id: scheduleId },
  });
  await lockedProcessingEditor(
    tx,
    candidate.organizationId,
    candidate.ownerId,
    candidate.projectId,
  );
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${candidate.ownerId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "ProjectReportSchedule" WHERE id=${candidate.id} FOR UPDATE`;
  const current = await tx.projectReportSchedule.findUniqueOrThrow({
    where: { id: candidate.id },
  });
  const member = await tx.membership.findUnique({
    where: {
      organizationId_userId: {
        organizationId: current.organizationId,
        userId: current.ownerId,
      },
    },
  });
  const org = await tx.organization.findUniqueOrThrow({
    where: { id: current.organizationId },
    select: { slackWebhookUrl: true },
  });
  const destination = requireReportSlackDestination(org.slackWebhookUrl);
  if (
    !current.enabled ||
    current.version !== version ||
    member?.id !== current.membershipId ||
    !["OWNER", "ADMIN"].includes(member.role) ||
    current.deliveryDestinationHash !== reportDestinationHash(destination)
  )
    throw new TRPCError({ code: "FORBIDDEN" });
  return { current, destination };
}

/** Claim once before network activity. Keep authorization locks through send;
 * revocations serialize before or after that send. Crashes/ambiguous responses
 * become UNKNOWN and are never automatically retried through another identity. */
export async function deliverPendingReports(
  db: PrismaClient,
  send: Send = postReport,
  now = new Date(),
) {
  await db.projectReportScheduleRun.updateMany({
    where: {
      deliveryStatus: "SENDING",
      deliveryAttemptAt: { lt: new Date(now.getTime() - 5 * 60000) },
    },
    data: { deliveryStatus: "UNKNOWN" },
  });
  const candidates = await db.projectReportScheduleRun.findMany({
    where: { deliveryStatus: "PENDING", status: "CAPTURED" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 10,
  });
  for (const receipt of candidates) {
    let claimed = false;
    let dispatchStarted = false;
    try {
      claimed = await db.$transaction(
        async (tx) => {
          await deliveryAuthority(
            tx,
            receipt.scheduleId,
            receipt.scheduleVersion,
          );
          const locked = await tx.$queryRaw<
            Array<{ id: string }>
          >`SELECT id FROM "ProjectReportScheduleRun" WHERE id=${receipt.id} AND "deliveryStatus"='PENDING' FOR UPDATE SKIP LOCKED`;
          if (!locked.length) return false;
          await tx.projectReportScheduleRun.update({
            where: { id: receipt.id },
            data: { deliveryStatus: "SENDING", deliveryAttemptAt: now },
          });
          return true;
        },
        { isolationLevel: "RepeatableRead", timeout: 10000 },
      );
      if (!claimed) continue;
      await db.$transaction(
        async (tx) => {
          const dispatchDeadline = Date.now() + 9000;
          const { current, destination } = await deliveryAuthority(
            tx,
            receipt.scheduleId,
            receipt.scheduleVersion,
          );
          await tx.$queryRaw`SELECT id FROM "ProjectReportScheduleRun" WHERE id=${receipt.id} FOR UPDATE`;
          const run = await tx.projectReportScheduleRun.findUniqueOrThrow({
            where: { id: receipt.id },
          });
          if (run.deliveryStatus !== "SENDING") return;
          const snapshot = await tx.projectReportSnapshot.findFirstOrThrow({
            where: {
              id: run.snapshotId!,
              organizationId: current.organizationId,
              projectId: current.projectId,
              createdById: current.ownerId,
            },
          });
          const payload = reportDeliveryPayload(snapshot.payload);
          if (Date.now() >= dispatchDeadline)
            throw new Error("Delivery authorization window expired");
          dispatchStarted = true;
          await send(destination, payload, dispatchDeadline);
          await tx.projectReportScheduleRun.update({
            where: { id: run.id },
            data: { deliveryStatus: "SENT", deliveredAt: now },
          });
          await tx.auditLog.create({
            data: {
              organizationId: current.organizationId,
              projectId: current.projectId,
              actorId: current.ownerId,
              action: "UPDATE",
              entityType: "ProjectReportScheduleRun",
              entityId: run.id,
              summary: "Delivered scheduled report aggregates",
              metadata: {
                scheduleVersion: current.version,
                destination: "configured-workspace-slack",
                content: "selected-inventory-execution-aggregates",
              },
            },
          });
        },
        { isolationLevel: "RepeatableRead", timeout: 12000 },
      );
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "";
      if (!claimed && code === "P2034") continue;
      await db.projectReportScheduleRun.updateMany({
        where: {
          id: receipt.id,
          deliveryStatus: claimed ? "SENDING" : "PENDING",
        },
        data: { deliveryStatus: dispatchStarted ? "UNKNOWN" : "CANCELLED" },
      });
    }
  }
}
