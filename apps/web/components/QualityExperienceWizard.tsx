"use client";

import { useEffect, useRef, useState } from "react";
import {
  EXPERIENCE_OFFERINGS,
  SOFTWARE_KINDS,
  GAME_GENRES,
  GAME_PLATFORMS,
  GAME_PLATFORM_GROUPS,
  MULTIPLAYER_MODES,
  HARDWARE_KINDS,
  PROCESS_KINDS,
  PROJECT_OPTIONAL_TOOLS,
  experienceProfileSchema,
  resolveQualityExperience,
  type ExperienceProfile,
} from "@vaettir/core";
import { trpcReact } from "@/lib/trpcReact";
import { useProjectPermissions } from "@/lib/use-project-permissions";
import { Modal } from "./Modal";

type Choice = { readonly id: string; readonly label: string };
type ChoiceField = Exclude<keyof ExperienceProfile, "version">;
type Screen = {
  id: string;
  title: string;
  help: string;
  field?: ChoiceField;
  choices?: readonly Choice[];
};
const JURISDICTIONS: readonly Choice[] = [
  { id: "United States", label: "United States" },
  { id: "European Union", label: "European Union" },
  { id: "United Kingdom", label: "United Kingdom" },
  { id: "Canada", label: "Canada" },
  { id: "Australia", label: "Australia" },
  { id: "Other / to be determined", label: "Other / to be determined" },
];

function emptyProfile(): ExperienceProfile {
  return {
    version: 1,
    offerings: [],
    softwareKinds: [],
    gameGenres: [],
    gamePlatforms: [],
    multiplayerModes: [],
    hardwareKinds: [],
    processKinds: [],
    jurisdictions: [],
  };
}

function screensFor(profile: ExperienceProfile): Screen[] {
  const has = (id: ExperienceProfile["offerings"][number]) =>
    profile.offerings.includes(id);
  const screens: Screen[] = [
    {
      id: "offerings",
      title: "What are you building or verifying?",
      help: "Choose all that apply. A connected product can combine software, hardware and regulated processes.",
      field: "offerings",
      choices: EXPERIENCE_OFFERINGS,
    },
  ];
  if (has("SOFTWARE"))
    screens.push({
      id: "software",
      title: "What kind of software?",
      help: "Choose the interfaces and product types your teams need to test.",
      field: "softwareKinds",
      choices: SOFTWARE_KINDS,
    });
  if (has("GAME")) {
    screens.push({
      id: "genres",
      title: "What type of game?",
      help: "Choose all relevant genres. Different mechanics can need different test approaches.",
      field: "gameGenres",
      choices: GAME_GENRES,
    });
    screens.push({
      id: "platforms",
      title: "Where will players play?",
      help: "Select specific target platforms, not just console or mobile. This records targets, not platform certification.",
      field: "gamePlatforms",
      choices: GAME_PLATFORMS,
    });
    screens.push({
      id: "multiplayer",
      title: "How do players interact?",
      help: "Choose the interaction modes to include in the testing context.",
      field: "multiplayerModes",
      choices: MULTIPLAYER_MODES,
    });
  }
  if (
    has("HARDWARE") ||
    has("HIL") ||
    has("MANUFACTURING") ||
    has("SYSTEM_INTEGRATION")
  )
    screens.push({
      id: "hardware",
      title: "What physical systems are involved?",
      help: "Choose the device, machinery and rig types. Simulated and physical results must remain distinct.",
      field: "hardwareKinds",
      choices: HARDWARE_KINDS,
    });
  if (
    has("FOOD_SAFETY") ||
    has("CLINICAL") ||
    has("LABORATORY") ||
    has("MANUFACTURING")
  )
    screens.push({
      id: "process",
      title: "Which processes need verification?",
      help: "Choose the procedures relevant to this project. Qualified reviewers still define methods and acceptance limits.",
      field: "processKinds",
      choices: PROCESS_KINDS,
    });
  screens.push({
    id: "tools",
    title: "Which optional tools should appear in navigation?",
    help: "Hide tools you do not use. Existing records and direct links remain readable. These choices do not grant access, connect services or authorize AI processing. Older projects show all tools until you explicitly change this selection.",
    field: "enabledTools",
    choices: PROJECT_OPTIONAL_TOOLS,
  });
  screens.push({
    id: "jurisdictions",
    title: "Where will this product or process operate?",
    help: "Optional context for regulatory review. These selections do not determine applicable regulations or certify compliance.",
    field: "jurisdictions",
    choices: JURISDICTIONS,
  });
  screens.push({
    id: "review",
    title: "Review your testing context",
    help: "Save this context and its guidance. Existing cases, plans, results and approvals are not rewritten.",
  });
  return screens;
}

function Guidance({ profile }: { profile: ExperienceProfile }) {
  const experience = resolveQualityExperience(profile);
  return (
    <div>
      {(
        [
          ["Test cases", experience.caseGuidance],
          ["Repeatable plans", experience.planGuidance],
          ["Run records", experience.runGuidance],
          ["Review boundaries", experience.reviewNotes],
        ] as const
      ).map(([title, guidance]) => (
        <section key={title} style={{ marginTop: 18 }}>
          <h4 style={{ marginBottom: 8 }}>{title}</h4>
          <ul style={{ paddingLeft: 20, margin: 0 }}>
            {guidance.map((text) => (
              <li key={text} style={{ marginBottom: 6 }}>
                {text}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Keep mounted while closed: unsaved edits survive reopening, not a page reload. */
export function QualityExperienceWizard({
  projectId,
  open,
  onClose,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
}) {
  const { loaded, canEdit, accessError, retryAccess } =
    useProjectPermissions(projectId);
  const query = trpcReact.project.experience.useQuery(
    { projectId },
    { enabled: open },
  );
  const save = trpcReact.project.saveExperience.useMutation();
  const utils = trpcReact.useUtils();
  const [draft, setDraft] = useState<ExperienceProfile | null>(null);
  const [baselineHash, setBaselineHash] = useState<string | null>(null);
  const [screenId, setScreenId] = useState("offerings");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [reloadConfirm, setReloadConfirm] = useState(false);
  const [jurisdictionInput, setJurisdictionInput] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Capture the first loaded baseline once. Background refetches must not replace
  // unsaved choices or silently change the hash that protects this draft.
  if (query.data && draft === null) {
    setDraft(query.data.experience ?? emptyProfile());
    setBaselineHash(query.data.profileHash);
  }
  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open, screenId]);
  const screens = screensFor(draft ?? emptyProfile());
  const index = Math.max(
    0,
    screens.findIndex((screen) => screen.id === screenId),
  );
  const screen = screens[index]!;
  const busy = save.isPending || (query.isFetching && reloadConfirm);
  function select(field: ChoiceField, id: string) {
    if (!draft || busy || !canEdit) return;
    setSaved(false);
    const values =
      draft[field] ??
      (field === "enabledTools"
        ? PROJECT_OPTIONAL_TOOLS.map((tool) => tool.id)
        : []);
    setDraft({
      ...draft,
      [field]: values.some((value) => value === id)
        ? values.filter((value) => value !== id)
        : [...values, id],
    } as ExperienceProfile);
  }
  function addJurisdiction() {
    const value = jurisdictionInput.trim();
    if (!draft || !value || busy || draft.jurisdictions.length >= 16) return;
    if (!draft.jurisdictions.includes(value)) select("jurisdictions", value);
    setJurisdictionInput("");
  }
  async function saveProfile() {
    if (!draft || baselineHash === null || !canEdit || busy) return;
    const parsed = experienceProfileSchema.safeParse(draft);
    if (!parsed.success) {
      setError(
        "Choose at least one offering and review your selections before saving.",
      );
      return;
    }
    setError(null);
    try {
      const result = await save.mutateAsync({
        projectId,
        expectedProfileHash: baselineHash,
        experience: parsed.data,
      });
      setDraft(result.experience);
      setBaselineHash(result.profileHash);
      setSaved(true);
      await utils.project.experience
        .invalidate({ projectId })
        .catch(() =>
          setError(
            "Testing context was saved, but the overview could not refresh. Reopen the project to load the saved profile.",
          ),
        );
    } catch (cause) {
      setError(
        `${cause instanceof Error ? cause.message : "The settings could not be saved."} Your draft is retained. Retry, or explicitly reload the saved profile.`,
      );
    }
  }
  async function reloadSaved() {
    setError(null);
    const result = await query.refetch();
    if (!result.data || result.error) {
      setError(
        "The saved profile could not be loaded. Your draft is retained.",
      );
      return;
    }
    setDraft(result.data.experience ?? emptyProfile());
    setBaselineHash(result.data.profileHash);
    setScreenId("offerings");
    setReloadConfirm(false);
    setSaved(false);
  }
  return (
    <Modal
      open={open}
      title="Customize testing workflow"
      onClose={onClose}
      dismissible={!busy}
    >
      {accessError ? (
        <div>
          <p role="alert">
            Project access could not be checked. No changes were saved.
          </p>
          <button className="btn-secondary" onClick={() => void retryAccess()}>
            Retry access check
          </button>
        </div>
      ) : !loaded ? (
        <p role="status">Checking project access…</p>
      ) : !canEdit ? (
        <p>
          A full editor seat is required to change this context. Existing
          project settings are unchanged.
        </p>
      ) : query.error && !draft ? (
        <div>
          <p role="alert">
            Could not load this project&apos;s testing context.
          </p>
          <button
            className="btn-secondary"
            onClick={() => void query.refetch()}
          >
            Try again
          </button>
        </div>
      ) : !draft || baselineHash === null ? (
        <p role="status">Loading saved context…</p>
      ) : (
        <>
          <p className="eyebrow" role="status">
            Step {index + 1} of {screens.length}
          </p>
          <progress
            value={index + 1}
            max={screens.length}
            aria-label="Testing context progress"
            style={{ width: "100%", marginBottom: 16 }}
          />
          <h3 ref={headingRef} tabIndex={-1}>
            {screen.title}
          </h3>
          <p className="text-muted">{screen.help}</p>
          {screen.field && screen.choices && (
            <fieldset
              className="experience-checklist"
              disabled={busy}
              style={{ marginBottom: 20 }}
            >
              <legend className="text-muted" style={{ fontSize: 13 }}>
                Select all that apply
                {screen.id !== "offerings" ? " (optional)" : ""}
              </legend>
              {(screen.field === "gamePlatforms"
                ? GAME_PLATFORM_GROUPS.map((group) => ({
                    label: group.label,
                    choices: screen.choices!.filter((choice) =>
                      (group.ids as readonly string[]).includes(choice.id),
                    ),
                  }))
                : [{ label: "", choices: screen.choices }]
              ).map((group) => (
                <div key={group.label} className="experience-checklist-section">
                  {group.label && <h4>{group.label}</h4>}
                  <div className="experience-checklist-options">
                    {group.choices.map(({ id, label }) => {
                      const selected = (
                        draft[screen.field!] ??
                        (screen.field === "enabledTools"
                          ? PROJECT_OPTIONAL_TOOLS.map((tool) => tool.id)
                          : [])
                      ).some((value) => value === id);
                      return (
                        <label key={id} className="experience-checklist-option">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => select(screen.field!, id)}
                          />
                          <span>{label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
              {screen.field === "jurisdictions" &&
                draft.jurisdictions
                  .filter(
                    (value) => !JURISDICTIONS.some(({ id }) => id === value),
                  )
                  .map((value) => (
                    <label key={value} className="experience-checklist-option">
                      <input
                        type="checkbox"
                        checked
                        onChange={() => select("jurisdictions", value)}
                      />
                      <span>{value}</span>
                    </label>
                  ))}
              {screen.field === "jurisdictions" && (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    marginTop: 16,
                    alignItems: "end",
                  }}
                >
                  <label style={{ flex: "1 1 180px" }}>
                    Another operating region
                    <input
                      value={jurisdictionInput}
                      maxLength={120}
                      onChange={(event) =>
                        setJurisdictionInput(event.target.value)
                      }
                      placeholder="Country, state or other jurisdiction"
                      style={{ width: "100%" }}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={
                      !jurisdictionInput.trim() ||
                      draft.jurisdictions.length >= 16
                    }
                    onClick={addJurisdiction}
                  >
                    Add region
                  </button>
                </div>
              )}
            </fieldset>
          )}
          {screen.id === "review" && (
            <>
              <dl style={{ margin: 0 }}>
                {(
                  [
                    ["Offerings", draft.offerings, EXPERIENCE_OFFERINGS],
                    ["Software", draft.softwareKinds, SOFTWARE_KINDS],
                    ["Game genres", draft.gameGenres, GAME_GENRES],
                    ["Game platforms", draft.gamePlatforms, GAME_PLATFORMS],
                    [
                      "Player interaction",
                      draft.multiplayerModes,
                      MULTIPLAYER_MODES,
                    ],
                    ["Physical systems", draft.hardwareKinds, HARDWARE_KINDS],
                    ["Processes", draft.processKinds, PROCESS_KINDS],
                    ["Operating regions", draft.jurisdictions, JURISDICTIONS],
                  ] as const
                )
                  .filter(([, values]) => values.length > 0)
                  .map(([label, values, catalog]) => (
                    <div key={label} style={{ marginBottom: 10 }}>
                      <dt style={{ fontWeight: 650 }}>{label}</dt>
                      <dd style={{ marginLeft: 0 }}>
                        {values
                          .map(
                            (id) =>
                              catalog.find((choice) => choice.id === id)
                                ?.label ?? id,
                          )
                          .join(", ")}
                      </dd>
                    </div>
                  ))}
              </dl>
              <p>
                Optional navigation tools:{" "}
                {draft.enabledTools === undefined
                  ? "All tools (legacy settings unchanged)"
                  : draft.enabledTools.length === 0
                    ? "Core workflow only"
                    : draft.enabledTools
                        .map(
                          (id) =>
                            PROJECT_OPTIONAL_TOOLS.find(
                              (tool) => tool.id === id,
                            )?.label ?? id,
                        )
                        .join(", ")}
                . Existing evidence and direct links remain available.
              </p>
              <details style={{ marginTop: 16 }}>
                <summary>Preview case, plan and run guidance</summary>
                <Guidance profile={draft} />
              </details>
              <p className="text-muted" style={{ marginTop: 16 }}>
                This saves context and guidance only. It does not create cases,
                run tests, connect repositories, spend credits or establish
                regulatory compliance.
              </p>
            </>
          )}
          {error && (
            <p role="alert" style={{ color: "var(--ember)" }}>
              {error}
            </p>
          )}
          {saved && (
            <p role="status">
              Testing context saved. Existing test records and approvals were
              preserved.
            </p>
          )}
          {reloadConfirm && (
            <section className="panel" style={{ marginTop: 16 }}>
              <p>
                Replace this local draft with the latest saved profile? Unsaved
                changes in this wizard will be discarded; existing test records
                will not change.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <button
                  className="btn-primary"
                  disabled={busy}
                  onClick={() => void reloadSaved()}
                >
                  Reload saved profile
                </button>
                <button
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => setReloadConfirm(false)}
                >
                  Keep my draft
                </button>
              </div>
            </section>
          )}
          <footer
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              justifyContent: "space-between",
              marginTop: 20,
            }}
          >
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <button
                className="btn-secondary"
                disabled={busy || index === 0}
                onClick={() => setScreenId(screens[index - 1]!.id)}
              >
                Back
              </button>
              <button
                className="btn-secondary"
                disabled={busy}
                onClick={onClose}
              >
                Close and keep draft
              </button>
            </div>
            {screen.id === "review" ? (
              <button
                className="btn-primary"
                disabled={busy || saved}
                onClick={() => void saveProfile()}
              >
                {busy ? "Saving…" : saved ? "Saved" : "Save testing context"}
              </button>
            ) : (
              <div style={{ display: "flex", gap: 8 }}>
                {screen.id !== "offerings" && (
                  <button
                    className="btn-secondary"
                    disabled={busy}
                    onClick={() => setScreenId(screens[index + 1]!.id)}
                  >
                    Skip for now
                  </button>
                )}
                <button
                  className="btn-primary"
                  disabled={busy || draft.offerings.length === 0}
                  onClick={() => setScreenId(screens[index + 1]!.id)}
                >
                  Continue
                </button>
              </div>
            )}
          </footer>
          <p className="text-muted" style={{ fontSize: 12, marginTop: 12 }}>
            Draft stays in this open page. Save before leaving or reloading.
          </p>
          <button
            className="btn-secondary"
            disabled={busy}
            onClick={() => setReloadConfirm(true)}
          >
            Start again from saved profile
          </button>
        </>
      )}
    </Modal>
  );
}

export function QualityExperienceSummary({ projectId }: { projectId: string }) {
  const query = trpcReact.project.experience.useQuery({ projectId });
  if (query.isLoading) return <p role="status">Loading testing context…</p>;
  if (query.error)
    return (
      <p role="alert">
        Testing context is unavailable. Existing project records remain
        available.
      </p>
    );
  const profile = query.data?.experience;
  if (!profile)
    return (
      <p className="text-muted">
        Testing context not configured. Customize it for the product, platforms
        and processes this project verifies.
      </p>
    );
  return (
    <section className="panel" style={{ margin: "16px 0" }}>
      <h2>Testing context</h2>
      <p>
        {profile.offerings
          .map(
            (id) =>
              EXPERIENCE_OFFERINGS.find((choice) => choice.id === id)?.label ??
              id,
          )
          .join(" · ")}
      </p>
      {profile.gamePlatforms.length > 0 && (
        <p className="text-muted">
          Game targets:{" "}
          {profile.gamePlatforms
            .map(
              (id) =>
                GAME_PLATFORMS.find((choice) => choice.id === id)?.label ?? id,
            )
            .join(", ")}
        </p>
      )}
      <details>
        <summary>Case, plan and run guidance</summary>
        <Guidance profile={profile} />
      </details>
    </section>
  );
}
