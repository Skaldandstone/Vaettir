import { redactTelemetryEvent } from "@vaettir/core";
import * as Sentry from "@sentry/react-native";

const releaseCommit = process.env.EXPO_PUBLIC_RELEASE_COMMIT;

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  release: releaseCommit && /^[a-f0-9]{40}$/i.test(releaseCommit) ? releaseCommit : undefined,
  enabled: Boolean(process.env.EXPO_PUBLIC_SENTRY_DSN),
  sendDefaultPii: false,
  tracesSampleRate: 0,
  beforeBreadcrumb: () => null,
  beforeSend: redactTelemetryEvent,
});
