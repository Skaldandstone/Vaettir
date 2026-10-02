"use client";

import { useState } from "react";
import type { PopulationDraft } from "@vaettir/core";
import { CreationWizard, WizardChoices } from "./CreationWizard";
import { SourceConnectionChips } from "./SourceConnectionChips";
import type { RepositoryProvider } from "./RepositoryConnectionContent";
import {
  nextPopulationStep,
  populationSteps as steps,
} from "../lib/population-navigation";

const sections = {
  context: "Objectives and system",
  sources: "Source selection",
  requirements: "Requirements",
  strategy: "Test strategy",
  cases: "Test cases",
  assessment: "Project assessment",
} as const;
const providers = {
  github: "GitHub",
  gitlab: "GitLab",
  bitbucket: "Bitbucket",
  "azure-devops": "Azure DevOps",
  git: "Self-hosted Git",
  perforce: "Perforce",
  svn: "SVN",
  jira: "Jira",
  linear: "Linear",
  document: "Documents",
} as const;
const titles = [
  "What would you like to update?",
  "What are you validating?",
  "Which sources will help?",
  "Review your setup draft",
];
export const emptyPopulationDraft: PopulationDraft = {
  schemaVersion: 1,
  step: "scope",
  sections: ["context", "sources"],
  objective: "",
  systemScope: "SOFTWARE",
  providers: [],
};

// Pure UI: connection selections are preferences, never connection-health claims.
export function PopulationWizard({
  initial,
  locked,
  status,
  onSave,
  onExit,
  documentsHref,
  onDocuments,
  onGitlab,
  onGithub,
  onRepository,
  projectId,
}: {
  initial: PopulationDraft;
  locked: boolean;
  status: string;
  onSave: (document: PopulationDraft) => void;
  onExit: () => void;
  documentsHref?: string;
  onDocuments?: () => void;
  onGitlab?: () => void;
  onGithub?: () => void;
  onRepository?: (provider: RepositoryProvider) => void;
  projectId?: string;
}) {
  const [draft, setDraft] = useState(initial);
  const step = steps.indexOf(draft.step);
  const move = (next: number) => {
    setDraft({
      ...draft,
      step: nextPopulationStep(step, next, draft.sections),
    });
  };
  return (
    <section className="population-wizard">
      <p className="text-muted">
        Update this project in small steps. Existing cases, requirements and
        approvals stay unchanged.
      </p>
      <fieldset disabled={locked} className="population-fields">
        <CreationWizard
          step={step}
          steps={["Choose sections", "Objectives", "Sources", "Review"]}
          title={titles[step]!}
          canContinue={draft.sections.length > 0}
          submitLabel="Save reviewed draft"
          onStepChange={move}
          onCancel={onExit}
          onSubmit={() => onSave(draft)}
        >
          {step === 0 && (
            <>
              <p>
                Run all sections again, or select only what needs new
                information.
              </p>
              <WizardChoices
                title="Sections to revisit"
                options={Object.values(sections)}
                selected={draft.sections.map((key) => sections[key])}
                onToggle={(label) => {
                  const key = (
                    Object.keys(sections) as PopulationDraft["sections"]
                  ).find((key) => sections[key] === label)!;
                  setDraft({
                    ...draft,
                    sections: draft.sections.includes(key)
                      ? draft.sections.filter((value) => value !== key)
                      : [...draft.sections, key],
                  });
                }}
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={() =>
                  setDraft({
                    ...draft,
                    sections: Object.keys(
                      sections,
                    ) as PopulationDraft["sections"],
                  })
                }
              >
                Select all sections
              </button>
            </>
          )}
          {step === 1 && (
            <>
              <label>
                System type
                <select
                  value={draft.systemScope}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      systemScope: event.target
                        .value as PopulationDraft["systemScope"],
                    })
                  }
                >
                  <option value="SOFTWARE">Software</option>
                  <option value="HARDWARE">Hardware</option>
                  <option value="BOTH">Hardware and software</option>
                  <option value="PROCESS">
                    Process or laboratory validation
                  </option>
                </select>
              </label>
              <label>
                What should this project establish? (optional)
                <textarea
                  rows={5}
                  maxLength={2000}
                  value={draft.objective}
                  placeholder="For example: verify the device, firmware and mobile app work safely together."
                  onChange={(event) =>
                    setDraft({ ...draft, objective: event.target.value })
                  }
                />
              </label>
              <p className="text-muted">
                Add what you know, or leave this blank. You can return to this
                draft later. Saving a setup draft does not change your approved
                project objective. Keep secrets and customer data out of this
                description.
              </p>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => move(step + 1)}
              >
                {draft.objective.trim()
                  ? "Keep this objective and continue"
                  : "Not sure yet · continue without an objective"}
              </button>
              <details>
                <summary>
                  Hardware, software, regulatory and compliance details
                  (optional)
                </summary>
                <p className="text-muted">
                  Add only what you know. These notes stay in your setup draft;
                  they do not establish compliance or change approved work.
                </p>
                {(
                  [
                    [
                      "hardware",
                      "Hardware and test equipment",
                      "For example: controller revision B, power supply, HIL bench and measurement ranges.",
                    ],
                    [
                      "software",
                      "Software and interfaces",
                      "For example: firmware, mobile apps, services and the interfaces between them.",
                    ],
                    [
                      "compliance",
                      "Standards and control frameworks to review",
                      "For example: ISO 27001 or an internal quality framework. This is not an attestation.",
                    ],
                    [
                      "regulatory",
                      "Regulatory obligations to investigate",
                      "For example: applicable jurisdiction, FDA, FAA, privacy or sector-specific rules. Record uncertainty; do not assume applicability.",
                    ],
                  ] as const
                ).map(([key, label, placeholder]) => (
                  <label key={key}>
                    {label}
                    <textarea
                      rows={3}
                      maxLength={1000}
                      placeholder={placeholder}
                      value={draft.contextDetails?.[key] ?? ""}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          contextDetails: {
                            hardware: "",
                            software: "",
                            compliance: "",
                            regulatory: "",
                            ...draft.contextDetails,
                            [key]: event.target.value,
                          },
                        })
                      }
                    />
                  </label>
                ))}
              </details>
            </>
          )}
          {step === 2 && (
            <>
              <p>
                Open a source to see its available actions. Sources are never
                read without your approval.
              </p>
              <SourceConnectionChips
                projectId={projectId}
                documentsHref={documentsHref}
                onDocuments={onDocuments}
                onRepository={
                  onRepository &&
                  ((provider) => {
                    setDraft((current) => ({
                      ...current,
                      providers: current.providers.includes(provider)
                        ? current.providers
                        : [...current.providers, provider],
                    }));
                    onRepository(provider);
                  })
                }
                onGitlab={
                  onGitlab &&
                  (() => {
                    setDraft((current) => ({
                      ...current,
                      providers: current.providers.includes("gitlab")
                        ? current.providers
                        : [...current.providers, "gitlab"],
                    }));
                    onGitlab();
                  })
                }
                onGithub={
                  onGithub &&
                  (() => {
                    setDraft((current) => ({
                      ...current,
                      providers: current.providers.includes("github")
                        ? current.providers
                        : [...current.providers, "github"],
                    }));
                    onGithub();
                  })
                }
              />
              {draft.providers.length > 0 && (
                <p className="text-muted">
                  Source interests in this draft:{" "}
                  {draft.providers.map((key) => providers[key]).join(", ")}.
                  These are not connected accounts.
                </p>
              )}
              <p className="text-muted">
                Connections are optional. Continue to review this draft without
                adding one.
              </p>
            </>
          )}
          {step === 3 && (
            <>
              <dl>
                <dt>Selected sections</dt>
                <dd>{draft.sections.map((key) => sections[key]).join(", ")}</dd>
                <dt>System</dt>
                <dd>{draft.systemScope.toLowerCase()}</dd>
                <dt>Objective</dt>
                <dd>{draft.objective || "Not specified"}</dd>
                {draft.contextDetails && (
                  <>
                    <dt>Hardware and test equipment</dt>
                    <dd>{draft.contextDetails.hardware || "Not specified"}</dd>
                    <dt>Software and interfaces</dt>
                    <dd>{draft.contextDetails.software || "Not specified"}</dd>
                    <dt>Standards and control frameworks to review</dt>
                    <dd>
                      {draft.contextDetails.compliance || "Not specified"}
                    </dd>
                    <dt>Regulatory obligations to investigate</dt>
                    <dd>
                      {draft.contextDetails.regulatory || "Not specified"}
                    </dd>
                  </>
                )}
                <dt>Source interests (not connection status)</dt>
                <dd>
                  {draft.providers.map((key) => providers[key]).join(", ") ||
                    "None selected"}
                </dd>
              </dl>
              <p>
                Saving retains your setup choices only. It does not generate or
                import records, overwrite approved work, or spend AI credits.
                Discovery and generation require a separate reviewed action.
              </p>
            </>
          )}
        </CreationWizard>
        <button
          type="button"
          className="btn-secondary"
          disabled={!draft.sections.length}
          onClick={() => onSave(draft)}
        >
          Save progress
        </button>
      </fieldset>
      <p role="status" aria-live="polite">
        {status}
      </p>
    </section>
  );
}
