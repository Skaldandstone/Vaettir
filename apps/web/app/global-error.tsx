"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

// P10-05: Next's app-router error boundary only catches errors from
// layout.tsx down -- global-error.tsx is the one place that can also catch
// an error thrown by the root layout itself, and it has to render its own
// <html>/<body> since it replaces the root layout entirely while active.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div style={{ padding: 40, textAlign: "center" }}>
          <h1>Something went wrong</h1>
          <p>The error has been reported. Try reloading the page.</p>
        </div>
      </body>
    </html>
  );
}
