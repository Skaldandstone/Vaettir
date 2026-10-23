import * as Sentry from "@sentry/node";

export type SchedulerFailureReporter = (
  error: unknown,
  scheduler: string,
) => void;

function reportSchedulerFailure(error: unknown, scheduler: string) {
  Sentry.captureException(error, { tags: { scheduler } });
}

export function createSafeSchedulerRunner(
  scheduler: string,
  tick: () => Promise<void>,
  reportFailure: SchedulerFailureReporter = reportSchedulerFailure,
) {
  let inFlight = false;

  return async function runSafely(): Promise<void> {
    if (inFlight) return;
    inFlight = true;
    try {
      await tick();
    } catch (error) {
      reportFailure(error, scheduler);
    } finally {
      inFlight = false;
    }
  };
}
