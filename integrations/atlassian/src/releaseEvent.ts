import { invokeRemote } from "@forge/api";
import { Queue, type AsyncEvent } from "@forge/events";

type ReleaseEvent = {
  versionId: string;
  observedAt: string;
  eventType: "avi:jira:released:version";
};
const queue = new Queue<ReleaseEvent>({ key: "vaettir-release-captures" });

// Only a product-event trigger can invoke this function. Neither function is a
// UI resolver or a web trigger. Queue bodies contain no access tokens or cases.
export async function enqueue(event: {
  eventType?: unknown;
  version?: { id?: unknown };
}) {
  if (
    event.eventType !== "avi:jira:released:version" ||
    typeof event.version?.id !== "string" ||
    !/^\d{1,40}$/.test(event.version.id)
  )
    throw new Error("Unsupported release notification");
  await queue.push({
    body: {
      eventType: "avi:jira:released:version",
      versionId: event.version.id,
      observedAt: new Date().toISOString(),
    },
    concurrency: { key: `release-${event.version.id}`, limit: 1 },
  });
}

export async function capture(event: AsyncEvent<ReleaseEvent>) {
  const response = await invokeRemote("vaettir", {
    path: "/api/integrations/forge/release-event",
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event.body),
  });
  // Throwing retains the queue's retry behavior. Never acknowledge a failed or
  // partial capture, log provider responses, or retain its short-lived token.
  if (!response.ok)
    throw new Error(`Vaettir release capture unavailable (${response.status})`);
}
