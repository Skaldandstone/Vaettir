// P10-07: liveness tracking for the in-process job pollers. `/health`
// (used by the ALB/ECS health check) deliberately stays a pure "is the
// process up" liveness probe - if it started checking dependencies too,
// a transient DB blip would cause ECS to cycle the task, which is worse
// than just serving degraded for a moment. This module backs a SEPARATE
// `/health/detailed` endpoint instead, for actual uptime monitoring/
// alerting to point at.
//
// In-memory, not persisted - correct for the single-instance deployment
// every poller's own comments already document (no Redis/queue infra
// exists yet). If this ever needs to scale beyond one API process, this
// needs to move to a shared store same as the pollers themselves would.
const lastTick = new Map<string, Date>();

export function recordHeartbeat(pollerName: string): void {
  lastTick.set(pollerName, new Date());
}

export interface HeartbeatStatus {
  name: string;
  lastTickAt: string | null;
  ageMs: number | null;
  stale: boolean;
}

// "Stale" means this poller hasn't ticked in longer than expected given
// its own known interval - the actual thresholds are supplied by the
// caller (server.ts), which is the one place that already knows every
// poller's real POLL_INTERVAL_MS, rather than duplicating those
// constants here.
export function getHeartbeatStatuses(expected: Record<string, number>, staleFactor = 3): HeartbeatStatus[] {
  const now = Date.now();
  return Object.entries(expected).map(([name, intervalMs]) => {
    const last = lastTick.get(name);
    const ageMs = last ? now - last.getTime() : null;
    return {
      name,
      lastTickAt: last ? last.toISOString() : null,
      ageMs,
      stale: ageMs === null || ageMs > intervalMs * staleFactor,
    };
  });
}
