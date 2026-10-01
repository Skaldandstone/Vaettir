"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

// P10-05: Next's app-router error boundary only catches errors from
// layout.tsx down -- global-error.tsx is the one place that can also catch
// an error thrown by the root layout itself, and it has to render its own
// <html>/<body> since it replaces the root layout entirely while active.
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  const updateRequired = /ChunkLoadError|Loading chunk/i.test(`${error.name} ${error.message}`);
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div style={{ padding: 40, textAlign: "center" }}>
          <h1>{updateRequired ? "An update is available" : "Something went wrong"}</h1>
          <p>{updateRequired ? "This page could not load a versioned application file. Reload to get the latest version." : "The error has been reported. Try reloading the page."}</p>
          <p>Unsaved changes may be lost. Saved project records and drafts are not removed by reloading.</p>
          <button type="button" onClick={() => window.location.reload()}>Reload latest version</button>
        </div>
      </body>
    </html>
  );
}
