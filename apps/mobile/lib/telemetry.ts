import { redactTelemetryEvent } from "@vaettir/core";
import * as Sentry from "@sentry/react-native";

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.EXPO_PUBLIC_SENTRY_DSN),
  sendDefaultPii: false,
  tracesSampleRate: 0,
  beforeBreadcrumb: () => null,
  beforeSend: redactTelemetryEvent,
});
