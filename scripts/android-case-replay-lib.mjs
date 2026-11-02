// Embedded in the paired connector. No imports, process startup or background loop.
export function createAndroidCaseReplay(native, { hash, nonce, now }) {
  const tickets = new Map(),
    runs = new Map(),
    uncertainDevices = new Set();
  const unsafe =
    /\b(?:sign[ -]?in|log[ -]?in|sign[ -]?out|log[ -]?out|password|pay|buy|purchase|order|checkout|subscribe|delete|remove|erase|send|submit|save|confirm|accept|agree|install|uninstall|grant|allow|deny|enable|disable|reset|transfer|upload|download)\b/i;
  const deny = () => {
    throw Error("The original reviewed replay could not be admitted.");
  };
  const plain = (v, keys) => {
    if (
      !v ||
      Object.getPrototypeOf(v) !== Object.prototype ||
      Object.keys(v).length !== keys.length ||
      keys.some((k) => !Object.hasOwn(v, k))
    )
      deny();
  };
  const text = (v, max = 200) => {
    if (
      typeof v !== "string" ||
      !v.length ||
      v.length > max ||
      [...v].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
    )
      deny();
    return v;
  };
  const digest = (v) => {
    if (!/^[a-f0-9]{64}$/.test(text(v, 64))) deny();
    return v;
  };
  const scopeKey = (s) => {
    const keys = ["projectId", "organizationId", "actorId", "sessionId"];
    plain(s, keys);
    return JSON.stringify(keys.map((k) => text(s[k])));
  };
  const selectorKey = (t) =>
    JSON.stringify([
      t.selector.kind,
      t.selector.value,
      t.selector.kind === "TEXT_CLASS" ? t.className : null,
    ]);
  const checkLocator = (t) => {
    plain(t, ["kind", "value", "className"]);
    text(t.value, 500);
    if (
      !["RESOURCE_ID", "ACCESSIBILITY_ID", "TEXT_CLASS"].includes(t.kind) ||
      (t.className !== null && typeof t.className !== "string") ||
      (t.kind === "TEXT_CLASS" && !t.className)
    )
      deny();
    if (t.className !== null) text(t.className, 200);
  };
  const locatorKey = (t) =>
    JSON.stringify([
      t.kind,
      t.value,
      t.kind === "TEXT_CLASS" ? t.className : null,
    ]);
  const checkPlan = (p) => {
    plain(p, ["caseId", "revision", "packageName", "steps"]);
    text(p.caseId);
    digest(p.revision);
    if (!/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+$/.test(text(p.packageName))) deny();
    if (
      !Array.isArray(p.steps) ||
      !p.steps.length ||
      p.steps.length > 12 ||
      new Set(p.steps.map((s) => s.stepId)).size !== p.steps.length
    )
      deny();
    for (const s of p.steps) {
      plain(s, ["stepId", "label", "expectedResult", "locator", "assertion"]);
      text(s.stepId);
      text(s.label);
      text(s.expectedResult, 10000);
      checkLocator(s.locator);
      plain(s.assertion, ["kind", "value", "relationReviewed"]);
      if (
        s.assertion.kind !== "VISIBLE_LABEL" ||
        s.assertion.relationReviewed !== true ||
        unsafe.test(s.label)
      )
        deny();
      text(s.assertion.value);
    }
  };
  const copy = (v) => JSON.parse(JSON.stringify(v));
  const view = (r) =>
    copy({
      version: 1,
      id: r.id,
      scope: r.scope,
      plan: r.plan,
      planHash: r.planHash,
      status: r.status,
      reason: r.reason,
      sequence: r.sequence,
      index: r.index,
      expiresAt: r.expiresAt,
      screen: r.screen,
      receipts: r.receipts,
      candidates: r.candidates,
      lastRequestId: r.lastRequestId,
      nativeExecutionIndependentlyVerified: false,
    });
  const screen = (observed) => {
    if (observed.blocked) throw Error("PROTECTED_SCREEN");
    digest(observed.id);
    text(observed.label);
    if (!Array.isArray(observed.controls) || observed.controls.length > 150)
      deny();
    return copy({
      id: observed.id,
      label: observed.label,
      controls: observed.controls.map((c) => ({
        id: c.id,
        label: c.name,
        navigable: c.navigable,
        target: c.target,
      })),
    });
  };
  const get = (input, origin) => {
    const r = runs.get(text(input.id, 64));
    if (!r || r.origin !== origin || r.scopeKey !== scopeKey(input.scope))
      deny();
    if (
      r.expiresAt <= now() &&
      !["COMPLETED", "UNCERTAIN", "STOPPED", "ASSERTION_FAILED"].includes(
        r.status,
      )
    ) {
      r.status = "STOPPED";
      r.reason = "EXPIRED";
      r.candidates = [];
    }
    return r;
  };
  const candidateList = (r, observed, step) => {
    // Native targets already encode uniqueness across the complete hierarchy,
    // including disabled/unnamed objects. Bounds-only targets never qualify.
    const words = (value) =>
      new Set(value.toLowerCase().match(/[a-z0-9]+/g) ?? []);
    const originalWords = words(step.label);
    return observed.controls
      .filter(
        (c) =>
          c.navigable &&
          c.target &&
          c.target.packageName === r.plan.packageName &&
          c.target.selector.kind !== "BOUNDS_ONLY" &&
          !unsafe.test(c.name) &&
          (c.name === step.label ||
            [...words(c.name)].filter((w) => originalWords.has(w)).length >=
              2) &&
          observed.controls.filter(
            (o) => o.target && selectorKey(o.target) === selectorKey(c.target),
          ).length === 1,
      )
      .map((c) => ({
        id: c.id,
        label: c.name,
        target: c.target,
        reasons:
          c.name === step.label ? ["SAME_LABEL"] : ["SHARED_LABEL_WORDS"],
      }));
  };
  return {
    active() {
      return [...runs.values()].some(
        (r) =>
          !["COMPLETED", "STOPPED", "ASSERTION_FAILED"].includes(r.status) &&
          (r.status === "UNCERTAIN" || r.expiresAt > now()),
      );
    },
    handle(command, input, origin) {
      text(origin, 512);
      if (command === "inspect") {
        plain(input, ["serial", "scope"]);
        const serial = text(input.serial);
        const key = scopeKey(input.scope);
        if (
          !/^[A-Za-z0-9._:-]+$/.test(serial) ||
          tickets.size >= 20 ||
          uncertainDevices.has(serial)
        )
          deny();
        const packageName = native.inspect(serial),
          ticket = nonce();
        tickets.set(ticket, {
          serial,
          packageName,
          scope: key,
          origin,
          expiresAt: now() + 120000,
        });
        return { ticket, packageName, expiresAt: now() + 120000 };
      }
      if (command === "start") {
        plain(input, ["ticket", "scope", "plan", "consent"]);
        checkPlan(input.plan);
        plain(input.consent, [
          "localObservation",
          "oneRun",
          "testAccount",
          "assertionsReviewed",
        ]);
        if (Object.values(input.consent).some((v) => v !== true)) deny();
        const t = tickets.get(text(input.ticket, 64)),
          key = scopeKey(input.scope);
        if (
          !t ||
          t.origin !== origin ||
          t.scope !== key ||
          t.expiresAt <= now() ||
          t.packageName !== input.plan.packageName ||
          runs.size >= 5 ||
          uncertainDevices.has(t.serial) ||
          this.active()
        )
          deny();
        tickets.delete(input.ticket); // consumed before any native observation
        if (native.inspect(t.serial) !== t.packageName) deny();
        const r = {
          id: nonce(),
          origin,
          scope: copy(input.scope),
          scopeKey: key,
          serial: t.serial,
          plan: copy(input.plan),
          planHash: hash(JSON.stringify(input.plan)),
          status: "ACTIVE",
          reason: null,
          sequence: 0,
          index: 0,
          expiresAt: now() + 300000,
          screen: null,
          receipts: [],
          candidates: [],
          lastRequestId: null,
          retryUsed: false,
        };
        runs.set(r.id, r);
        try {
          r.screen = screen(native.observe(t.serial, t.packageName));
        } catch {
          r.status = "STOPPED";
          r.reason = "TARGET_UNAVAILABLE";
        }
        return view(r);
      }
      if (command === "read" || command === "stop") {
        plain(input, ["id", "scope"]);
        const r = get(input, origin);
        if (command === "stop" && r.status !== "UNCERTAIN") {
          r.status = "STOPPED";
          r.reason = "STOPPED_BY_USER";
          r.candidates = [];
        }
        return view(r);
      }
      plain(
        input,
        command === "retry"
          ? [
              "id",
              "scope",
              "revision",
              "sequence",
              "requestId",
              "screenId",
              "candidateId",
              "retryApproved",
            ]
          : ["id", "scope", "revision", "sequence", "requestId", "screenId"],
      );
      const r = get(input, origin),
        retry = command === "retry";
      if (
        !["next", "retry"].includes(command) ||
        input.revision !== r.plan.revision ||
        input.sequence !== r.sequence ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
          text(input.requestId, 36),
        ) ||
        input.screenId !== r.screen?.id ||
        (retry
          ? r.status !== "REPAIR_REVIEW" ||
            r.retryUsed ||
            input.retryApproved !== true
          : r.status !== "ACTIVE")
      )
        deny();
      const selected = retry
        ? r.candidates.find((c) => c.id === input.candidateId)
        : null;
      if (retry && !selected) deny();
      r.sequence++;
      r.lastRequestId = input.requestId;
      if (retry) r.retryUsed = true;
      let attempted = false;
      try {
        const before = native.observe(r.serial, r.plan.packageName);
        if (before.blocked || before.id !== r.screen.id) {
          r.status = "STOPPED";
          r.reason = "SCREEN_CHANGED";
          r.candidates = [];
          return view(r);
        }
        const step = r.plan.steps[r.index];
        const wanted = retry
          ? selectorKey(selected.target)
          : locatorKey(step.locator);
        const matches = before.controls.filter(
          (c) => c.target && selectorKey(c.target) === wanted,
        );
        if (
          matches.length !== 1 ||
          !matches[0].navigable ||
          matches[0].target.packageName !== r.plan.packageName ||
          matches[0].target.selector.kind === "BOUNDS_ONLY" ||
          unsafe.test(matches[0].name)
        ) {
          r.status = retry ? "STOPPED" : "REPAIR_REVIEW";
          r.reason = matches.length
            ? "TARGET_AMBIGUOUS_OR_UNSUPPORTED"
            : "TARGET_NOT_FOUND";
          r.candidates =
            matches.length || retry ? [] : candidateList(r, before, step);
          return view(r);
        }
        const target = matches[0],
          b = target.bounds;
        if (
          retry &&
          (target.id !== selected.id ||
            JSON.stringify(target.target) !== JSON.stringify(selected.target))
        )
          throw Error();
        if (
          !Array.isArray(b) ||
          b.length !== 4 ||
          b.some((v) => !Number.isInteger(v) || v < 0 || v > 20000) ||
          b[2] <= b[0] ||
          b[3] <= b[1] ||
          JSON.stringify(b) !== JSON.stringify(target.target.bounds)
        )
          throw Error();
        if (
          now() >= r.expiresAt ||
          native.inspect(r.serial) !== r.plan.packageName
        )
          throw Error();
        const expected = [
          "shell",
          "input",
          "tap",
          String(Math.floor((b[0] + b[2]) / 2)),
          String(Math.floor((b[1] + b[3]) / 2)),
        ];
        attempted = true;
        const commandArgs = native.tap(r.serial, b);
        if (JSON.stringify(commandArgs) !== JSON.stringify(expected))
          throw Error();
        const after = screen(native.observe(r.serial, r.plan.packageName));
        const actual = after.controls.filter(
          (c) => c.label === step.assertion.value,
        ).length;
        const assertion = {
          kind: "VISIBLE_LABEL",
          value: step.assertion.value,
          relationReviewed: true,
          matches: actual,
          passed: actual === 1,
        };
        r.receipts.push({
          stepId: step.stepId,
          expectedResult: step.expectedResult,
          requestId: input.requestId,
          sequence: r.sequence,
          from: before.id,
          to: after.id,
          observedAt: now(),
          originalLocator: step.locator,
          target: target.target,
          commandArgs,
          assertion,
          repaired: retry,
          repairApproval: retry
            ? {
                candidateId: selected.id,
                screenId: before.id,
                reasons: selected.reasons,
                retryApproved: true,
              }
            : null,
        });
        r.screen = after;
        r.candidates = [];
        if (!assertion.passed) {
          r.status = "ASSERTION_FAILED";
          r.reason = "REVIEW_EXPECTATION_OR_APP_DEFECT";
        } else {
          r.index++;
          r.retryUsed = false;
          r.status = r.index === r.plan.steps.length ? "COMPLETED" : "ACTIVE";
          r.reason = null;
        }
      } catch {
        r.status = attempted ? "UNCERTAIN" : "STOPPED";
        r.reason = attempted
          ? "ACTION_OUTCOME_UNCERTAIN_NO_RETRY"
          : "TARGET_UNAVAILABLE";
        r.candidates = [];
        if (attempted) uncertainDevices.add(r.serial);
      }
      return view(r);
    },
  };
}
