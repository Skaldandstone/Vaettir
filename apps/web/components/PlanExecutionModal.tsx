"use client";

import { useEffect, useId, useRef, useState } from "react";
import { trpcReact, type RouterInputs, type RouterOutputs } from "@/lib/trpcReact";
import { useProjectPermissions } from "@/lib/use-project-permissions";
import { PlanExecutionReviewed } from "./PlanExecutionReviewed";

type Template = NonNullable<RouterOutputs["testPlans"]["executionTemplate"]["template"]>;
type Baseline = RouterOutputs["testPlans"]["executionTemplate"];
type RunRequest = RouterInputs["manualExecution"]["start"];
type Screen = "cases" | "configurations" | "save-review" | "choose-run" | "run-review";
const emptyTemplate = (): Template => ({ version: 1, testCaseIds: [], configurations: [] });

/** Original mounted owner: keep its hook order/state slots, but never reinterpret
 * a held legacy body as a newly native-pinned request. Route replacement/reload
 * recovery is not provided by this in-memory shell. */
export function PlanExecutionModal({ open, onClose, id, projectId, onSaved, organizationId }: {
  open: boolean; onClose: () => void; id: string; projectId: string;
  onSaved?: () => void; organizationId?: string;
}) {
  const permission = useProjectPermissions(projectId);
  const [serverSearch, setServerSearch] = useState("");
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [previousCursors, setPreviousCursors] = useState<(string | undefined)[]>([]);
  const query = trpcReact.testPlans.executionTemplate.useQuery(
    { id, search: serverSearch, cursor }, { enabled: false },
  );
  const profileQuery = trpcReact.project.experience.useQuery({ projectId }, { enabled: false });
  const saveMutation = trpcReact.testPlans.saveExecutionTemplate.useMutation();
  const startMutation = trpcReact.manualExecution.start.useMutation();
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [profileBaseline, setProfileBaseline] = useState<RouterOutputs["project"]["experience"] | null>(null);
  const [draft, setDraft] = useState<Template>(emptyTemplate);
  const [screen, setScreen] = useState<Screen>("cases");
  const [search, setSearch] = useState("");
  const [activeId, setActiveId] = useState("");
  const [selectedConfiguration, setSelectedConfiguration] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [runAttempt, setRunAttempt] = useState<RunRequest | null>(null);
  const [startedRunId, setStartedRunId] = useState<string | null>(null);
  const [definitiveRejection, setDefinitiveRejection] = useState(false);
  const [everAmbiguous, setEverAmbiguous] = useState(false);
  const [selectedCaseLabels, setSelectedCaseLabels] = useState<Record<string, string>>({});
  const [refreshCandidate, setRefreshCandidate] = useState<{
    plan: Baseline; profile: NonNullable<typeof profileBaseline>;
  } | null>(null);
  const prefix = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  // Preserve the original two effect slots without old seed, debounce, refetch,
  // save or start dispatch. Retained slots are never reset on close/access loss.
  useEffect(() => {}, [screen, open]);
  useEffect(() => {}, [search]);
  void [permission, setServerSearch, setCursor, previousCursors, setPreviousCursors,
    query, profileQuery, saveMutation, startMutation, setBaseline, setProfileBaseline,
    setDraft, setScreen, setSearch, activeId, setActiveId, selectedConfiguration,
    setSelectedConfiguration, error, setError, setBusy, saved, setSaved, setRunAttempt,
    setStartedRunId, definitiveRejection, setDefinitiveRejection, everAmbiguous,
    setEverAmbiguous, selectedCaseLabels, setSelectedCaseLabels, refreshCandidate,
    setRefreshCandidate, prefix, heading];
  const legacyBlocked = !!runAttempt || !!startedRunId || busy;
  const legacyHasDraft = !!baseline || !!profileBaseline || draft.testCaseIds.length > 0 || draft.configurations.length > 0;
  return <PlanExecutionReviewed projectId={projectId} testPlanId={id}
    organizationId={organizationId} open={open} onClose={onClose} onSaved={onSaved}
    legacyBlocked={legacyBlocked} legacyHasDraft={legacyHasDraft} />;
}
