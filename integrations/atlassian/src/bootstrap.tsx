import React, { useEffect, useState } from "react";
import { Button, SectionMessage, Spinner, Stack, Text } from "@forge/react";

class RenderBoundary extends React.Component<
  React.PropsWithChildren,
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <SectionMessage
          appearance="error"
          title="Vaettir could not display this view"
        >
          <Text>
            Reload this page to try again. No tests or sharing permissions were
            changed.
          </Text>
        </SectionMessage>
      );
    return this.props.children;
  }
}

/** Render a native shell before loading feature code, with a recoverable failure. */
export function Bootstrap({
  macroConfig,
}: {
  macroConfig?: Record<string, unknown>;
}) {
  const [App, setApp] = useState<React.ComponentType<{
    macroConfig?: Record<string, unknown>;
  }> | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setFailed(false);
    const timer = setTimeout(() => {
      if (active) setFailed(true);
    }, 15000);
    import("./quality")
      .then((module) => {
        if (active) {
          clearTimeout(timer);
          setApp(() => module.QualityApp);
        }
      })
      .catch(() => {
        if (active) {
          clearTimeout(timer);
          setFailed(true);
        }
      });
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [attempt]);
  if (App)
    return (
      <RenderBoundary>
        <App macroConfig={macroConfig} />
      </RenderBoundary>
    );
  return (
    <Stack space="space.150">
      {failed ? (
        <SectionMessage appearance="error" title="Vaettir could not load">
          <Text>
            The native view did not finish loading. No tests or sharing
            permissions were changed.
          </Text>
          <Button onClick={() => setAttempt((value) => value + 1)}>
            Try again
          </Button>
        </SectionMessage>
      ) : (
        <>
          <Spinner label="Loading Quality Intelligence" />
          <Text>Loading Quality Intelligence…</Text>
        </>
      )}
    </Stack>
  );
}
