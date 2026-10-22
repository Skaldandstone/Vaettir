// Embedded verbatim in the single-file connector; no imports or process startup.
// One explicit HTTP step performs at most one native navigation action. There is
// no background device loop to survive a closed page or transport interruption.
export function createAndroidExplorer(native, { hash, nonce, now }) {
  const tickets = new Map(),
    sessions = new Map();
  const deny = () => {
    throw Error(
      "Exploration request is unavailable or outside its original scope.",
    );
  };
  const plain = (value, keys) => {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype) deny();
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      Reflect.ownKeys(descriptors).length !== keys.length ||
      keys.some(
        (k) =>
          !descriptors[k]?.enumerable ||
          !Object.hasOwn(descriptors[k], "value"),
      )
    )
      deny();
  };
  const text = (value, max = 200) => {
    if (
      typeof value !== "string" ||
      !value.length ||
      value.length > max ||
      Array.from(value).some(
        (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
      )
    )
      deny();
    return value;
  };
  const scopeKey = (value) => {
    plain(value, ["projectId", "organizationId", "actorId", "sessionId"]);
    return JSON.stringify([
      text(value.projectId),
      text(value.organizationId),
      text(value.actorId),
      text(value.sessionId),
    ]);
  };
  const unsafe =
    /\b(?:sign[ -]?in|log[ -]?in|sign[ -]?out|log[ -]?out|password|pay|buy|purchase|order|checkout|subscribe|delete|remove|erase|send|submit|save|confirm|accept|agree|install|uninstall|grant|allow|deny|enable|disable|reset|transfer|upload|download)\b/i;
  const checkOrigin = (origin) => text(origin, 512);
  const snapshot = (session) =>
    JSON.parse(
      JSON.stringify({
        version: 1,
        id: session.id,
        packageName: session.packageName,
        scope: session.scope,
        status: session.status,
        reason: session.reason,
        startedAt: session.startedAt,
        expiresAt: session.expiresAt,
        sequence: session.sequence,
        actionCount: session.actionCount,
        limits: session.limits,
        screens: session.screens,
        journeys: session.journeys,
        skippedControls: session.skippedControls,
        lastOperation: session.lastOperation,
        observation: "BEFORE_AFTER_NOT_ATOMIC",
        aiProcessingPerformed: false,
        backgroundNavigation: false,
      }),
    );
  const get = (input, origin, keys = []) => {
    plain(input, ["id", "scope", ...keys]);
    const session = sessions.get(text(input.id, 64));
    if (
      !session ||
      session.origin !== checkOrigin(origin) ||
      session.scopeKey !== scopeKey(input.scope)
    )
      deny();
    if (
      now() >= session.expiresAt &&
      !["STOPPED", "COMPLETED"].includes(session.status)
    ) {
      session.status = "STOPPED";
      session.reason = "TIME_LIMIT";
    }
    return session;
  };
  const remember = (session, observed) => {
    // Native adapter validates the complete hierarchy, current package, bounds
    // and count before returning. Never clip controls or silently sanitize text.
    if (observed.blocked) {
      session.status = "STOPPED";
      session.reason = "FORM_AUTH_OR_EMBEDDED_CONTENT";
      return false;
    }
    const existing = session.screens.find((s) => s.id === observed.id);
    if (!existing && session.screens.length >= session.limits.screens) {
      session.status = "COMPLETED";
      session.reason = "SCREEN_LIMIT";
      return false;
    }
    if (!existing)
      session.screens.push({
        id: observed.id,
        label: observed.label,
        controls: observed.controls.map((c) => ({
          id: c.id,
          name: c.name,
          role: c.role,
          navigable: c.navigable,
        })),
      });
    session.current = observed;
    return true;
  };
  return {
    handle(command, input, origin) {
      checkOrigin(origin);
      if (command === "inspect") {
        plain(input, ["serial", "scope"]);
        const scope = scopeKey(input.scope);
        const serial = text(input.serial);
        if (!/^[A-Za-z0-9._:-]+$/.test(serial) || tickets.size >= 20) deny();
        const packageName = native.inspect(serial); // package identity only, no hierarchy
        const ticket = nonce();
        tickets.set(ticket, {
          serial,
          packageName,
          scope,
          origin,
          expiresAt: now() + 120000,
        });
        return { version: 1, ticket, packageName, expiresAt: now() + 120000 };
      }
      if (command === "start") {
        plain(input, [
          "ticket",
          "scope",
          "consent",
          "navigationNames",
          "limits",
        ]);
        plain(input.consent, ["localObservation", "navigation", "testAccount"]);
        plain(input.limits, ["actions", "screens", "seconds"]);
        if (Object.values(input.consent).some((v) => v !== true)) deny();
        const ticket = tickets.get(text(input.ticket, 64)),
          scope = scopeKey(input.scope);
        if (
          !ticket ||
          ticket.origin !== origin ||
          ticket.scope !== scope ||
          ticket.expiresAt <= now() ||
          sessions.size >= 5
        )
          deny();
        if (
          [...sessions.values()].some(
            (s) =>
              s.serial === ticket.serial &&
              !["STOPPED", "COMPLETED"].includes(s.status) &&
              s.expiresAt > now(),
          )
        )
          deny();
        if (
          !Array.isArray(input.navigationNames) ||
          input.navigationNames.length < 1 ||
          input.navigationNames.length > 25
        )
          deny();
        const names = input.navigationNames.map((n) => text(n, 80));
        if (
          new Set(names).size !== names.length ||
          names.some((n) => unsafe.test(n))
        )
          deny();
        for (const [key, max] of [
          ["actions", 24],
          ["screens", 12],
          ["seconds", 300],
        ])
          if (
            !Number.isSafeInteger(input.limits[key]) ||
            input.limits[key] < 1 ||
            input.limits[key] > max
          )
            deny();
        // Single-use admission consumed before native observation, including failure.
        tickets.delete(input.ticket);
        if (native.inspect(ticket.serial) !== ticket.packageName) deny();
        const session = {
          id: input.ticket,
          serial: ticket.serial,
          packageName: ticket.packageName,
          scope: input.scope,
          scopeKey: scope,
          origin,
          status: "ACTIVE",
          reason: null,
          startedAt: new Date(now()).toISOString(),
          expiresAt: now() + input.limits.seconds * 1000,
          sequence: 0,
          actionCount: 0,
          limits: input.limits,
          names: new Set(names),
          screens: [],
          journeys: [],
          skippedControls: 0,
          visited: new Set(),
          scrolled: new Set(),
          path: [],
          stack: [],
          current: null,
          lastOperation: null,
        };
        sessions.set(session.id, session);
        try {
          remember(
            session,
            native.observe(session.serial, session.packageName),
          );
        } catch {
          session.status = "STOPPED";
          session.reason = "TARGET_OR_OBSERVATION_UNAVAILABLE";
        }
        return snapshot(session);
      }
      const session = get(
        input,
        origin,
        command === "next" ? ["sequence", "requestId"] : [],
      );
      if (command === "read") return snapshot(session);
      if (command === "stop") {
        session.status = "STOPPED";
        session.reason = "STOPPED_BY_USER";
        return snapshot(session);
      }
      if (command === "pause") {
        if (session.status === "ACTIVE") {
          session.status = "PAUSED";
          session.reason = "PAUSED_BY_USER";
        }
        return snapshot(session);
      }
      if (command === "resume") {
        if (session.status !== "PAUSED") deny();
        session.status = "ACTIVE";
        session.reason = null;
        return snapshot(session);
      }
      if (
        command !== "next" ||
        session.status !== "ACTIVE" ||
        input.sequence !== session.sequence ||
        !/^[a-f0-9-]{36}$/.test(text(input.requestId, 36))
      )
        deny();
      if (session.sequence >= session.limits.actions) {
        session.status = "COMPLETED";
        session.reason = "ACTION_LIMIT";
        return snapshot(session);
      }
      // Consume sequence BEFORE observing/acting. A lost reply cannot repeat it.
      session.sequence++;
      session.lastOperation = {
        requestId: input.requestId,
        sequence: session.sequence,
        actionAttempted: false,
        outcome: "UNVERIFIED",
      };
      try {
        const before = native.observe(session.serial, session.packageName);
        if (before.blocked || before.id !== session.current?.id) {
          session.status = "STOPPED";
          session.reason = "SCREEN_CHANGED_REVIEW_REQUIRED";
          return snapshot(session);
        }
        const candidates = before.controls.filter(
          (c) =>
            c.navigable &&
            session.names.has(c.name) &&
            !unsafe.test(c.name) &&
            before.controls.filter(
              (other) => other.name === c.name && other.navigable,
            ).length === 1,
        );
        session.skippedControls = before.controls.filter(
          (c) => c.navigable && !candidates.includes(c),
        ).length;
        const target = candidates.find(
          (c) => !session.visited.has(before.id + ":" + c.id),
        );
        let action;
        if (target) {
          session.visited.add(before.id + ":" + target.id);
          action = { kind: "TAP", label: target.name, targetId: target.id };
        } else if (before.scroll && !session.scrolled.has(before.id)) {
          session.scrolled.add(before.id);
          action = {
            kind: "SCROLL",
            label: "Scroll down",
            targetId: before.scroll.id,
          };
        } else if (session.stack.length)
          action = { kind: "BACK", label: "Back", targetId: "android-back" };
        else {
          session.status = "COMPLETED";
          session.reason = "APPROVED_NAVIGATION_EXHAUSTED";
          session.lastOperation.outcome = "NO_ACTION";
          return snapshot(session);
        }
        if (
          now() >= session.expiresAt ||
          native.inspect(session.serial) !== session.packageName
        )
          throw Error();
        session.lastOperation.actionAttempted = true;
        session.actionCount++;
        if (action.kind === "TAP") native.tap(session.serial, target.bounds);
        else if (action.kind === "SCROLL")
          native.scroll(session.serial, before.scroll.bounds);
        else native.back(session.serial);
        const after = native.observe(session.serial, session.packageName);
        session.lastOperation.outcome = "OBSERVED";
        if (!remember(session, after) || after.blocked)
          return snapshot(session);
        const step = {
          sequence: session.sequence,
          action,
          from: { id: before.id, label: before.label },
          to: { id: after.id, label: after.label },
          observedAt: new Date(now()).toISOString(),
        };
        if (action.kind === "BACK") {
          const prior = session.stack.pop();
          session.path = prior.path;
          if (after.id !== prior.screenId) {
            session.status = "STOPPED";
            session.reason = "UNEXPECTED_BACK_DESTINATION";
          }
        } else if (after.id !== before.id) {
          if (session.path.some((p) => p.from.id === after.id)) {
            session.status = "STOPPED";
            session.reason = "NAVIGATION_CYCLE";
          } else {
            if (action.kind === "TAP")
              session.stack.push({
                screenId: before.id,
                path: [...session.path],
              });
            session.path.push(step);
            if (action.kind === "TAP")
              session.journeys.push({
                id: hash(JSON.stringify(session.path)),
                sessionId: session.id,
                packageName: session.packageName,
                startedAt: session.startedAt,
                steps: [...session.path],
              });
          }
        }
      } catch {
        session.status = "STOPPED";
        session.reason = session.lastOperation.actionAttempted
          ? "ACTION_OUTCOME_UNCERTAIN_NO_RETRY"
          : "TARGET_OR_OBSERVATION_UNAVAILABLE";
      }
      return snapshot(session);
    },
  };
}
