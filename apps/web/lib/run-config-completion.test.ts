import { describe, expect, it } from "vitest";
import {
  RunConfigCompletionController,
  type RunStartFrame,
  type RunStartCompletionView,
} from "./run-config-completion";
import {
  freezeRunConfiguration,
  type ReviewedRunConfiguration,
} from "./run-configuration-request";
const scope = {
  projectId: "project",
  organizationId: "org",
  clerkActorId: "clerk",
  sessionId: "session-A",
};
const session = { userId: "clerk", sessionId: "session-A" };
const context = {
  configuration: "  configuration\nretained  ",
  platform: "",
  build: "build",
  hardwareRevision: "",
  firmwareVersion: "",
  rig: "",
  batchOrLot: "",
  environment: "",
  calibrationReference: "",
  protocolReference: "",
};
const ack = (request: ReviewedRunConfiguration) => ({
  testRunId: `manual_${"a".repeat(64)}`,
  originalOrganizationId: request.originalOrganizationId,
  expectedClerkActorId: request.expectedClerkActorId,
  idempotencyKey: request.idempotencyKey,
});
function deferred() {
  let resolve!: (value: unknown) => void, reject!: (cause: unknown) => void;
  const promise = new Promise<unknown>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture() {
  const published: RunStartCompletionView[] = [];
  const controller = new RunConfigCompletionController("project", (view) =>
    published.push(view),
  );
  const frame: RunStartFrame = {
    scope,
    open: true,
    canWrite: true,
    draftKey: "reviewed-original-body",
  };
  controller.attach();
  controller.bindFrame(frame);
  controller.review(session, controller.snapshot().activationEpoch);
  let generated = 0,
    opens = 0;
  const factory = () => {
    generated++;
    return freezeRunConfiguration(
      {
        projectId: "project",
        testCaseIds: ["case-one", "case-two"],
        expectedProfileHash: "b".repeat(64),
        executionContext: context,
        originalOrganizationId: "org",
        expectedClerkActorId: "clerk",
      },
      `00000000-0000-4000-8000-${String(generated).padStart(12, "0")}`,
    );
  };
  const open = () => {
    opens++;
  };
  return {
    controller,
    frame,
    factory,
    open,
    published,
    get generated() {
      return generated;
    },
    get opens() {
      return opens;
    },
  };
}
describe("actual run-start completion controller (synthetic, not native auth)", () => {
  it("navigates only once after exact current-frame ACK, retaining the original configuration/body", async () => {
    const h = fixture(),
      before = JSON.stringify(context);
    await h.controller.submit(
      h.controller.snapshot().activationEpoch,
      h.factory,
      async (input) => ack(input),
      () => session,
      h.open,
    );
    expect(h.opens).toBe(1);
    expect(h.generated).toBe(1);
    expect(h.controller.snapshot()).toMatchObject({
      pendingRequest: null,
      canStart: false,
      canOpen: false,
      confirmed: { opened: true },
    });
    expect(JSON.stringify(context)).toBe(before);
    await h.controller.submit(
      h.controller.snapshot().activationEpoch,
      h.factory,
      async (input) => ack(input),
      () => session,
      h.open,
    );
    expect(h.generated).toBe(1);
    expect(h.opens).toBe(1);
  });
  it.each(["close", "authority", "session", "ABA", "draft"])(
    "late exact ACK privately settles after %s; only explicit restored Open may navigate",
    async (change) => {
      const h = fixture(),
        wait = deferred();
      let sent!: ReviewedRunConfiguration;
      const start = h.controller.submit(
        h.controller.snapshot().activationEpoch,
        h.factory,
        (input) => {
          sent = input;
          return wait.promise;
        },
        () => session,
        h.open,
      );
      const exact = JSON.stringify(sent);
      if (change === "close")
        h.controller.bindFrame({ ...h.frame, open: false });
      if (change === "authority")
        h.controller.bindFrame({ ...h.frame, canWrite: false });
      if (change === "session")
        h.controller.bindFrame({
          ...h.frame,
          scope: { ...scope, sessionId: "session-B" },
        });
      if (change === "ABA") {
        h.controller.bindFrame({
          ...h.frame,
          scope: { ...scope, sessionId: "session-B" },
        });
        h.controller.bindFrame(h.frame);
      }
      if (change === "draft")
        h.controller.bindFrame({
          ...h.frame,
          draftKey: "changed-parent-selection",
        });
      wait.resolve(ack(sent));
      await start;
      expect(h.opens).toBe(0);
      expect(h.controller.snapshot().pendingRequest).toBeNull();
      expect(h.controller.snapshot().confirmed?.request).toBe(sent);
      expect(JSON.stringify(sent)).toBe(exact);
      h.controller.bindFrame(h.frame);
      await h.controller.submit(
        h.controller.snapshot().activationEpoch,
        h.factory,
        async (input) => ack(input),
        () => session,
        h.open,
      );
      expect(h.generated).toBe(1);
      expect(
        h.controller.openConfirmed(
          session,
          h.open,
          h.controller.snapshot().activationEpoch,
        ),
      ).toBe(true);
      expect(h.opens).toBe(1);
      expect(
        h.controller.openConfirmed(
          session,
          h.open,
          h.controller.snapshot().activationEpoch,
        ),
      ).toBe(false);
    },
  );
  it("SDK session mismatch rejects before factory creation even if React frame still looks current", async () => {
    const h = fixture();
    expect(
      await h.controller.submit(
        h.controller.snapshot().activationEpoch,
        h.factory,
        async (input) => ack(input),
        () => ({ ...session, sessionId: "changed-SDK-session" }),
        h.open,
      ),
    ).toBe(false);
    expect(h.generated).toBe(0);
    expect(h.opens).toBe(0);
  });
  it("SDK loss immediately before ACK hides the display frame before React auth commits", async () => {
    const h = fixture(),
      wait = deferred();
    let sent!: ReviewedRunConfiguration;
    let live = session;
    const start = h.controller.submit(
      h.controller.snapshot().activationEpoch,
      h.factory,
      (input) => {
        sent = input;
        return wait.promise;
      },
      () => live,
      h.open,
    );
    live = { ...session, sessionId: "session-B" };
    wait.resolve(ack(sent));
    await start;
    expect(h.opens).toBe(0);
    expect(h.controller.snapshot()).toMatchObject({
      authorized: false,
      canOpen: false,
      pendingRequest: null,
    });
    expect(h.controller.snapshot().confirmed?.request).toBe(sent);
    h.controller.bindFrame(h.frame);
    expect(
      h.controller.openConfirmed(
        session,
        h.open,
        h.controller.snapshot().activationEpoch,
      ),
    ).toBe(true);
  });
  it.each(["rejected", "malformed"])(
    "late %s response revokes the SDK-lost frame before publishing any actions",
    async (kind) => {
      const h = fixture(),
        wait = deferred();
      let sent!: ReviewedRunConfiguration;
      let live = session;
      const start = h.controller.submit(
        h.controller.snapshot().activationEpoch,
        h.factory,
        (input) => {
          sent = input;
          return wait.promise;
        },
        () => live,
        h.open,
      );
      live = { ...session, sessionId: "session-B" };
      if (kind === "rejected") wait.reject({ data: { code: "FORBIDDEN" } });
      else wait.resolve({ ...ack(sent), idempotencyKey: "wrong" });
      await start;
      expect(h.controller.snapshot()).toMatchObject({
        authorized: false,
        canStart: false,
        canRetry: false,
        canOpen: false,
        confirmed: null,
      });
      expect(h.controller.snapshot().pendingRequest).toBe(sent);
      expect(h.generated).toBe(1);
      expect(h.opens).toBe(0);
      h.controller.bindFrame(h.frame);
      expect(h.controller.snapshot().canRetry).toBe(true);
    },
  );
  it("unknown or mismatched ACK retains identical object/UUID across changed candidates and later definitive refusal", async () => {
    const h = fixture(),
      sent: ReviewedRunConfiguration[] = [];
    const first = await h.controller.submit(
      h.controller.snapshot().activationEpoch,
      h.factory,
      async (input) => {
        sent.push(input);
        return { ...ack(input), idempotencyKey: "wrong" };
      },
      () => session,
      h.open,
    );
    expect(first).toBe(false);
    expect(h.controller.snapshot().pendingRequest).toBe(sent[0]);
    h.controller.bindFrame({ ...h.frame, draftKey: "other-cases-and-context" });
    await h.controller.submit(
      h.controller.snapshot().activationEpoch,
      () => {
        throw Error("Must not create replacement body");
      },
      async (input) => {
        sent.push(input);
        throw { data: { code: "CONFLICT" } };
      },
      () => session,
      h.open,
    );
    expect(sent[1]).toBe(sent[0]);
    expect(h.generated).toBe(1);
    expect(h.controller.snapshot().pendingRequest).toBe(sent[0]);
    expect(h.opens).toBe(0);
  });
  it("synchronous busy latch blocks two same-event submissions before React state can render", async () => {
    const h = fixture(),
      wait = deferred();
    let sent!: ReviewedRunConfiguration,
      calls = 0;
    const epoch = h.controller.snapshot().activationEpoch;
    const submit = (input: ReviewedRunConfiguration) => {
      calls++;
      sent = input;
      return wait.promise;
    };
    const first = h.controller.submit(
      epoch,
      h.factory,
      submit,
      () => session,
      h.open,
    );
    expect(
      await h.controller.submit(
        epoch,
        h.factory,
        submit,
        () => session,
        h.open,
      ),
    ).toBe(false);
    expect(calls).toBe(1);
    expect(h.generated).toBe(1);
    wait.resolve(ack(sent));
    await first;
  });
  it("first definite refusal preserves draft ownership but requires an explicit fresh review before another UUID", async () => {
    const h = fixture();
    await h.controller.submit(
      h.controller.snapshot().activationEpoch,
      h.factory,
      async () => {
        throw { data: { code: "BAD_REQUEST" } };
      },
      () => session,
      h.open,
    );
    expect(h.controller.snapshot()).toMatchObject({
      pendingRequest: null,
      confirmed: null,
      canStart: false,
      canEdit: true,
    });
    await h.controller.submit(
      h.controller.snapshot().activationEpoch,
      h.factory,
      async (input) => ack(input),
      () => session,
      h.open,
    );
    expect(h.generated).toBe(1);
    h.controller.review(session, h.controller.snapshot().activationEpoch);
    await h.controller.submit(
      h.controller.snapshot().activationEpoch,
      h.factory,
      async (input) => ack(input),
      () => session,
      h.open,
    );
    expect(h.generated).toBe(2);
  });
  it("stale action epoch cannot review/create/open against a newer frame", async () => {
    const h = fixture(),
      old = h.controller.snapshot().activationEpoch;
    h.controller.bindFrame({ ...h.frame, draftKey: "new-reviewed-context" });
    h.controller.review(session, h.controller.snapshot().activationEpoch);
    expect(h.controller.review(session, old)).toBe(false);
    await h.controller.submit(
      old,
      h.factory,
      async (input) => ack(input),
      () => session,
      h.open,
    );
    expect(h.generated).toBe(0);
    await h.controller.submit(
      h.controller.snapshot().activationEpoch,
      h.factory,
      async (input) => ack(input),
      () => session,
    );
    expect(h.opens).toBe(0);
    expect(h.controller.openConfirmed(session, h.open, old)).toBe(false);
    expect(h.controller.snapshot().confirmed).not.toBeNull();
  });
  it("unmount privately settles the old instance without publishing or calling a new host", async () => {
    const h = fixture(),
      wait = deferred();
    let sent!: ReviewedRunConfiguration;
    const start = h.controller.submit(
      h.controller.snapshot().activationEpoch,
      h.factory,
      (input) => {
        sent = input;
        return wait.promise;
      },
      () => session,
      h.open,
    );
    h.controller.detach();
    const visible = h.published.length;
    wait.resolve(ack(sent));
    await start;
    expect(h.published).toHaveLength(visible);
    expect(h.opens).toBe(0);
    expect(h.controller.snapshot().confirmed?.request).toBe(sent);
  });
  it("another project/org/actor/session can neither retry nor open the retained original intent", async () => {
    for (const changed of [
      { projectId: "other" },
      { organizationId: "other" },
      { clerkActorId: "other" },
      { sessionId: "other" },
    ]) {
      const h = fixture();
      await h.controller.submit(
        h.controller.snapshot().activationEpoch,
        h.factory,
        async (input) => ack(input),
        () => session,
      );
      h.controller.bindFrame({ ...h.frame, scope: { ...scope, ...changed } });
      expect(
        h.controller.openConfirmed(
          session,
          h.open,
          h.controller.snapshot().activationEpoch,
        ),
      ).toBe(false);
      expect(h.generated).toBe(1);
    }
  });
  it("missing/throwing host navigation never becomes another run start", async () => {
    const h = fixture();
    await h.controller.submit(
      h.controller.snapshot().activationEpoch,
      h.factory,
      async (input) => ack(input),
      () => session,
    );
    expect(h.controller.snapshot().confirmed).not.toBeNull();
    expect(
      h.controller.openConfirmed(
        session,
        () => {
          throw Error("Navigation failed");
        },
        h.controller.snapshot().activationEpoch,
      ),
    ).toBe(false);
    expect(h.controller.snapshot().canOpen).toBe(true);
    await h.controller.submit(
      h.controller.snapshot().activationEpoch,
      h.factory,
      async (input) => ack(input),
      () => session,
      h.open,
    );
    expect(h.generated).toBe(1);
  });
  it("closing/reopening after a guarded open permits explicit same-receipt navigation recovery, never a new start", async () => {
    const h = fixture();
    await h.controller.submit(
      h.controller.snapshot().activationEpoch,
      h.factory,
      async (input) => ack(input),
      () => session,
      h.open,
    );
    expect(h.opens).toBe(1);
    h.controller.bindFrame({ ...h.frame, open: false });
    h.controller.bindFrame(h.frame);
    expect(h.controller.snapshot().canOpen).toBe(true);
    expect(
      h.controller.openConfirmed(
        session,
        h.open,
        h.controller.snapshot().activationEpoch,
      ),
    ).toBe(true);
    expect(h.opens).toBe(2);
    expect(h.generated).toBe(1);
    expect(h.controller.snapshot().canStart).toBe(false);
  });
});
