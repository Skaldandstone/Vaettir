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

function monitoredFixture() {
  const published: RunStartCompletionView[] = [],
    controller = new RunConfigCompletionController(
      "project",
      (view) => published.push(view),
      true,
    );
  let live: typeof session | null = { ...session },
    resource: object;
  const callbacks = new Set<() => void>(),
    cleanupObservations: boolean[] = [];
  const sdk = {
    addListener: (callback: () => void) => {
      callbacks.add(callback);
      callback();
      return () => {
        cleanupObservations.push(controller.snapshot().authorized);
        callbacks.delete(callback);
      };
    },
  };
  resource = sdk;
  const frame: RunStartFrame = {
    scope,
    open: true,
    canWrite: true,
    draftKey: "original",
  };
  controller.attach();
  controller.bindFrame(frame);
  let readAction: (() => void) | null = null;
  const read = () => {
      const action = readAction;
      readAction = null;
      action?.();
      return live;
    },
    current = () => resource;
  const release = controller.installSdkMonitor(sdk, read, current);
  controller.review(session, controller.snapshot().activationEpoch);
  let generated = 0,
    opens = 0;
  const factory = () => {
    generated++;
    return freezeRunConfiguration(
      {
        projectId: "project",
        testCaseIds: ["one", "two"],
        expectedProfileHash: "a".repeat(64),
        executionContext: context,
        originalOrganizationId: "org",
        expectedClerkActorId: "clerk",
      },
      "00000000-0000-4000-8000-000000000001",
    );
  };
  return {
    controller,
    published,
    callbacks,
    frame,
    factory,
    read,
    current,
    sdk,
    release,
    cleanupObservations,
    open: () => {
      opens++;
    },
    emit: (next: typeof session | null) => {
      live = next;
      for (const callback of [...callbacks]) callback();
    },
    replace: (next: object) => {
      resource = next;
    },
    onRead: (action: () => void) => {
      readAction = action;
    },
    get generated() {
      return generated;
    },
    get opens() {
      return opens;
    },
  };
}
describe("installed-resource run-start lifecycle (synthetic SDK, not native authority)", () => {
  it("observed SDK A-B-A without bindFrame permanently revokes old review until explicit fresh admission", async () => {
    const h = monitoredFixture(),
      oldEpoch = h.controller.snapshot().activationEpoch;
    h.emit({ ...session, sessionId: "session-B" });
    h.emit({ ...session });
    h.controller.bindFrame(h.frame);
    expect(h.controller.snapshot().authorized).toBe(false);
    expect(h.controller.canEdit(session, oldEpoch)).toBe(false);
    await h.controller.submit(
      oldEpoch,
      h.factory,
      async (input) => ack(input),
      h.read,
      h.open,
    );
    expect(h.generated).toBe(0);
    expect(h.opens).toBe(0);
    const token = h.controller.beginRecheck(session)!;
    expect(h.controller.finishRecheck(token, session)).toBe(true);
    expect(h.controller.snapshot()).toMatchObject({
      authorized: true,
      canStart: false,
    });
    h.controller.review(session, h.controller.snapshot().activationEpoch);
    await h.controller.submit(
      h.controller.snapshot().activationEpoch,
      h.factory,
      async (input) => ack(input),
      h.read,
      h.open,
    );
    expect(h.generated).toBe(1);
    expect(h.opens).toBe(1);
  });
  it("exact late ACK after SDK-only A-B-A settles privately and requires explicit fresh recheck and Open", async () => {
    const h = monitoredFixture(),
      waiting = deferred();
    const pending = h.controller.submit(
        h.controller.snapshot().activationEpoch,
        h.factory,
        () => waiting.promise,
        h.read,
        h.open,
      ),
      request = h.controller.snapshot().pendingRequest!;
    h.emit({ ...session, sessionId: "session-B" });
    h.emit({ ...session });
    waiting.resolve(ack(request));
    await pending;
    expect(h.opens).toBe(0);
    expect(h.controller.snapshot()).toMatchObject({
      authorized: false,
      pendingRequest: null,
      confirmed: { request },
      canStart: false,
      canEdit: false,
    });
    h.controller.bindFrame(h.frame);
    expect(h.controller.snapshot().authorized).toBe(false);
    const token = h.controller.beginRecheck(session)!;
    expect(h.controller.finishRecheck(token, session)).toBe(true);
    expect(
      h.controller.openConfirmed(
        session,
        h.open,
        h.controller.snapshot().activationEpoch,
      ),
    ).toBe(true);
    expect(
      h.controller.openConfirmed(
        session,
        h.open,
        h.controller.snapshot().activationEpoch,
      ),
    ).toBe(false);
    expect(h.generated).toBe(1);
    expect(h.opens).toBe(1);
  });
  it.each(["rejection", "malformed"])(
    "late %s after SDK-only A-B-A retains exact original unknown request",
    async (mode) => {
      const h = monitoredFixture(),
        waiting = deferred();
      const pending = h.controller.submit(
          h.controller.snapshot().activationEpoch,
          h.factory,
          () => waiting.promise,
          h.read,
          h.open,
        ),
        request = h.controller.snapshot().pendingRequest!,
        body = JSON.stringify(request);
      h.emit({ ...session, sessionId: "session-B" });
      h.emit({ ...session });
      if (mode === "rejection")
        waiting.reject(Error("private transport fixture"));
      else waiting.resolve({ ...ack(request), idempotencyKey: "wrong" });
      await pending;
      expect(h.controller.snapshot().authorized).toBe(false);
      expect(h.controller.snapshot().pendingRequest).toBe(request);
      expect(JSON.stringify(request)).toBe(body);
      expect(h.controller.snapshot().error).not.toContain(
        "private transport fixture",
      );
      expect(h.opens).toBe(0);
      const token = h.controller.beginRecheck(session)!;
      h.controller.finishRecheck(token, session);
      await h.controller.submit(
        h.controller.snapshot().activationEpoch,
        () => {
          throw Error("No new factory");
        },
        async (input) => {
          expect(input).toBe(request);
          return ack(input);
        },
        h.read,
        h.open,
      );
      expect(h.generated).toBe(1);
      expect(h.opens).toBe(1);
    },
  );
  it.each(["absent", "void", "throw"])(
    "%s listener cannot authorize a strict production controller",
    (mode) => {
      const c = new RunConfigCompletionController("project", () => {}, true);
      c.attach();
      c.bindFrame({ scope, open: true, canWrite: true });
      const resource =
        mode === "absent"
          ? {}
          : {
              addListener: (listener: () => void) => {
                listener();
                if (mode === "throw") throw Error("private SDK error");
                return undefined;
              },
            };
      c.installSdkMonitor(
        resource,
        () => session,
        () => resource,
      );
      expect(c.snapshot()).toMatchObject({
        authorized: false,
        canEdit: false,
        recheckRequired: true,
      });
      expect(c.beginRecheck(session)).toBeNull();
    },
  );
  it("resource replacement is observed synchronously before old action, cleanup revokes before calling third party", () => {
    const h = monitoredFixture(),
      oldEpoch = h.controller.snapshot().activationEpoch;
    h.replace({});
    expect(h.controller.canEdit(session, oldEpoch)).toBe(false);
    expect(h.cleanupObservations).toEqual([false]);
    expect(h.controller.snapshot().recheckRequired).toBe(true);
  });
  it("a new installed resource and copied/token/old-generation metadata cannot silently restore authority", () => {
    const h = monitoredFixture(),
      token = h.controller.beginRecheck(session)!;
    const resource = {
      addListener: (listener: () => void) => {
        listener();
        return () => {};
      },
    };
    h.replace(resource);
    h.controller.installSdkMonitor(resource, h.read, h.current);
    h.controller.bindFrame(h.frame);
    expect(h.controller.snapshot().authorized).toBe(false);
    expect(h.controller.finishRecheck(token, session)).toBe(false);
    const fresh = h.controller.beginRecheck(session)!;
    expect(h.controller.finishRecheck({ ...fresh }, session)).toBe(false);
    expect(h.controller.finishRecheck(fresh, session)).toBe(true);
  });
  it("close during recheck invalidates its token; same visibility reopen requires a new explicit read", () => {
    const h = monitoredFixture(),
      token = h.controller.beginRecheck(session)!;
    h.controller.bindFrame({ ...h.frame, open: false });
    h.controller.bindFrame(h.frame);
    expect(h.controller.finishRecheck(token, session)).toBe(false);
  });
  it("null session cannot revive when A returns and mutable SDK objects are remembered by value", () => {
    const h = monitoredFixture();
    h.emit(null);
    h.emit(session);
    expect(h.controller.snapshot().authorized).toBe(false);
    const token = h.controller.beginRecheck(session)!;
    h.controller.finishRecheck(token, session);
    const mutable = { ...session };
    h.emit(mutable);
    mutable.sessionId = "session-B";
    h.emit(mutable);
    mutable.sessionId = session.sessionId;
    h.emit(mutable);
    expect(h.controller.snapshot().authorized).toBe(false);
  });
  it("detached late ACK privately settles without publication; stale cleanup callbacks cannot restore admission", async () => {
    const h = monitoredFixture(),
      waiting = deferred(),
      callbacks = [...h.callbacks];
    const pending = h.controller.submit(
        h.controller.snapshot().activationEpoch,
        h.factory,
        () => waiting.promise,
        h.read,
        h.open,
      ),
      request = h.controller.snapshot().pendingRequest!;
    h.controller.detach();
    h.release();
    const published = h.published.length;
    callbacks.forEach((callback) => callback());
    waiting.resolve(ack(request));
    await pending;
    expect(h.published).toHaveLength(published);
    expect(h.opens).toBe(0);
    expect(h.controller.snapshot().confirmed?.request).toBe(request);
  });
  it("throwing session/resource readers fail closed without displaying the thrown body", () => {
    const h = monitoredFixture();
    const resource = { addListener: () => () => {} };
    h.replace(resource);
    h.controller.installSdkMonitor(
      resource,
      () => {
        throw Error("private session reader");
      },
      h.current,
    );
    expect(h.controller.snapshot().authorized).toBe(false);
    expect(h.controller.snapshot().error).toBeNull();
  });
  it("SDK transitions during finish's synchronous read invalidate the token before admission is published", () => {
    const h = monitoredFixture(),
      token = h.controller.beginRecheck(session)!;
    h.onRead(() => {
      h.emit({ ...session, sessionId: "session-B" });
      h.emit({ ...session });
    });
    expect(h.controller.finishRecheck(token, session)).toBe(false);
    expect(h.controller.snapshot().authorized).toBe(false);
  });
  it("synchronous installation revocation still disposes the unsubscribe returned later exactly once", () => {
    const c = new RunConfigCompletionController("project", () => {}, true);
    c.attach();
    c.bindFrame({ scope, open: true, canWrite: true });
    let resource: object,
      cleanup = 0;
    const initial = {
      addListener: (changed: () => void) => {
        resource = {};
        changed();
        return () => {
          cleanup++;
          expect(c.snapshot().authorized).toBe(false);
        };
      },
    };
    resource = initial;
    const release = c.installSdkMonitor(
      initial,
      () => session,
      () => resource,
    );
    release();
    expect(cleanup).toBe(1);
    expect(c.snapshot().authorized).toBe(false);
  });
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
  it("does not publish raw factory errors or submit an unreviewable configuration", async () => {
    const h = fixture();
    let submissions = 0;
    await h.controller.submit(
      h.controller.snapshot().activationEpoch,
      () => {
        throw Error("PRIVATE_SYNTHETIC_FACTORY_DETAILS");
      },
      async () => {
        submissions++;
        return {};
      },
      () => session,
      h.open,
    );
    expect(submissions).toBe(0);
    expect(h.controller.snapshot().error).toContain("No request was submitted");
    expect(JSON.stringify(h.published)).not.toContain(
      "PRIVATE_SYNTHETIC_FACTORY_DETAILS",
    );
    expect(h.controller.snapshot().pendingRequest).toBeNull();
  });
  it("keeps original refusal classification and unknown UUID while withholding raw transport error text", async () => {
    for (const definitive of [false, true]) {
      const h = fixture();
      let submitted: ReviewedRunConfiguration | null = null;
      await h.controller.submit(
        h.controller.snapshot().activationEpoch,
        h.factory,
        async (request) => {
          submitted = request;
          throw Object.assign(
            Error("PRIVATE_SYNTHETIC_TRANSPORT_DETAILS"),
            definitive ? { data: { code: "PRECONDITION_FAILED" } } : {},
          );
        },
        () => session,
        h.open,
      );
      expect(h.generated).toBe(1);
      expect(h.opens).toBe(0);
      expect(h.controller.snapshot().pendingRequest).toBe(
        definitive ? null : submitted,
      );
      expect(h.controller.snapshot().error).toContain(
        definitive ? "refused" : "unconfirmed",
      );
      expect(JSON.stringify(h.published)).not.toContain(
        "PRIVATE_SYNTHETIC_TRANSPORT_DETAILS",
      );
      expect(h.controller.snapshot().error).toContain(
        "no automatic retry was sent",
      );
    }
  });
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
