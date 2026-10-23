import * as Sentry from "@sentry/react-native";
import Constants from "expo-constants";
import * as Updates from "expo-updates";

// P10-05 (mobile half): error reporting to the `vaettir-mobile` Sentry
// project. Same shape as the API (apps/api/src/instrument.ts) and web
// (apps/web/instrumentation-client.ts) halves, and the same Expo pattern
// as Kall's apps/mobile/App.tsx:
//
// - Inert without a DSN. The DSN is resolved once in app.config.js
//   (EXPO_PUBLIC_SENTRY_DSN -> extra.sentryDsn) so `expo config` shows
//   exactly what a build will use.
// - Inert in __DEV__ unless explicitly opted in. Every local dev run of
//   the API used to report into the real production project (six of the
//   first nine vaettir-api issues were one workstation - see
//   NEEDS_ATTENTION.md); the mobile app starts out with that lesson
//   applied. Opt in from a dev bundle with EXPO_PUBLIC_SENTRY_DEBUG=1,
//   the mobile counterpart of the API's SENTRY_DEBUG=1.
//
// Privacy: Vaettir is a QA/test-management product, so what leaves the
// device is narrowed before Sentry ever sees it - no user identity, no
// breadcrumbs (console lines, fetch URLs and navigation history are all
// channels for an email or a token to ride along), no session replay,
// no performance tracing. An event carries the exception, the stack,
// the OS/app version and the release channel: enough to fix a bug,
// nothing that says whose session it was.

const dsn = Constants.expoConfig?.extra?.sentryDsn as string | undefined;
const releaseCommit = Constants.expoConfig?.extra?.releaseCommit as string | undefined;
const debugOptIn = process.env.EXPO_PUBLIC_SENTRY_DEBUG === "1";

/** Strip anything that could identify a person or leak a credential. */
export function scrubEvent<T extends Sentry.Event>(event: T): T {
  delete event.user;
  delete event.breadcrumbs;
  // Future-proofing: the JS ExpoContext integration sets
  // `contexts.device.name` to the user-assigned device name (e.g. "James's
  // iPhone") whenever `expo-device` is present, regardless of
  // `sendDefaultPii`. `expo-device` isn't installed today, so this is
  // dormant, but strip it here so adding that dependency later can't
  // silently leak a name through this event path.
  if (event.contexts?.device) {
    delete event.contexts.device.name;
  }
  if (event.request) {
    // A URL may carry a Clerk ticket, a shareable test-status link token
    // or a query string - the method plus the route on the transaction
    // is enough to find the failing call.
    const { method } = event.request;
    event.request = method ? { method } : {};
  }
  return event;
}

export function initSentry(): void {
  // Updates.channel is the EAS Update channel baked into an EAS build
  // (`development` / `preview`, later `production` - see eas.json); it is
  // null in Expo Go and in dev clients, which fall back to __DEV__.
  const environment = Updates.channel ?? (__DEV__ ? "development" : "production");

  Sentry.init({
    dsn,
    enabled: Boolean(dsn) && (!__DEV__ || debugOptIn),
    environment,
    release: releaseCommit && /^[a-f0-9]{40}$/i.test(releaseCommit) ? releaseCommit : undefined,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    maxBreadcrumbs: 0,
    beforeBreadcrumb: () => null,
    beforeSend: scrubEvent,
    // Replay/profiling integrations are simply never added; nothing to
    // disable. Sentry's own console output only when explicitly asked.
    debug: debugOptIn,
  });

  // Which OTA update (if any) the crashing JS came from - an update id
  // is a build artifact identifier, not a person.
  if (Updates.updateId) {
    Sentry.setTag("expo.update_id", Updates.updateId);
  }
}
