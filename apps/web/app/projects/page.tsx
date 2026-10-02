"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpcReact } from "../../lib/trpcReact";
import { Modal } from "../../components/Modal";
import { ConfirmAction } from "../../components/ConfirmAction";
import { EmptyState, Icon, PageHeading } from "../../components/ui/Workspace";
import {
  canAdministerOrganization,
  canEditProject,
} from "../../lib/membership";
import { RecoveryMessage } from "../../components/RecoveryMessage";
import { CreationWizard, WizardChoices } from "../../components/CreationWizard";

const SOFTWARE_TYPES = [
  "Web",
  "Mobile",
  "API/services",
  "Desktop",
  "Embedded firmware",
  "Data/AI",
  "Cloud infrastructure",
];
const HARDWARE_TYPES = [
  "Electronics/PCB",
  "Embedded device",
  "IoT",
  "Robotics",
  "Drone/UAS",
  "Medical device",
  "Industrial controls",
  "Manufacturing equipment",
];
const TEST_ENVIRONMENTS = [
  "CI",
  "Simulator/SIL",
  "HIL bench",
  "Lab bench",
  "Manufacturing line",
  "Cleanroom",
  "Field test",
  "Production",
];
const QUALITY_OBJECTIVES = [
  "Release confidence",
  "Safety",
  "Reliability",
  "Performance",
  "Regulatory evidence",
  "Manufacturing quality",
  "Security",
  "Traceability",
];
const COMPLIANCE_OPTIONS = [
  "NIST CSF",
  "NIST manufacturing",
  "CISA Secure by Design",
  "PCI DSS",
  "ISO 27001",
  "Other / not sure",
];
const REGULATORY_AREAS = [
  "Health and medical",
  "Aviation",
  "Privacy and personal data",
  "Financial services",
  "Industrial and product safety",
  "Other / applicability unknown",
];
const EXECUTION_SOURCES = [
  "Manual procedures",
  "CI automation",
  "Lab instruments",
  "HIL/SIL rigs",
  "Mobile devices",
  "Imported test management data",
  "Supplier evidence",
];

function toggleValue(values: string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

// P1-15
export default function ProjectsPage() {
  const router = useRouter();
  const utils = trpcReact.useUtils();

  const orgsQuery = trpcReact.organization.mine.useQuery();
  const orgId = orgsQuery.data?.[0]?.id;
  const orgName = orgsQuery.data?.[0]?.name ?? "";
  const membership = orgsQuery.data?.[0];
  const canEdit = canEditProject(membership);
  const canDelete = canAdministerOrganization(membership);

  const projectsQuery = trpcReact.project.list.useQuery(
    { organizationId: orgId! },
    { enabled: !!orgId },
  );
  const projects = projectsQuery.data ?? [];

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [createStep, setCreateStep] = useState(0);
  const [objective, setObjective] = useState("");
  const [systemScope, setSystemScope] = useState<
    "SOFTWARE" | "HARDWARE" | "BOTH" | "PROCESS"
  >("SOFTWARE");
  const [softwareTypes, setSoftwareTypes] = useState<string[]>([]);
  const [hardwareTypes, setHardwareTypes] = useState<string[]>([]);
  const [testEnvironments, setTestEnvironments] = useState<string[]>([]);
  const [qualityObjectives, setQualityObjectives] = useState<string[]>([]);
  const [complianceNeeds, setComplianceNeeds] = useState<string[]>([]);
  const [regulatoryNeeds, setRegulatoryNeeds] = useState<string[]>([]);
  const [executionSources, setExecutionSources] = useState<string[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editRepoUrl, setEditRepoUrl] = useState("");
  const [editDefaultBranch, setEditDefaultBranch] = useState("main");
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);

  useEffect(() => {
    if (orgsQuery.data && orgsQuery.data.length === 0)
      router.push("/onboarding");
  }, [orgsQuery.data, router]);

  const createMutation = trpcReact.project.create.useMutation({
    onSuccess: (project) => {
      setName("");
      setCreateStep(0);
      setObjective("");
      setSystemScope("SOFTWARE");
      setSoftwareTypes([]);
      setHardwareTypes([]);
      setTestEnvironments([]);
      setQualityObjectives([]);
      setComplianceNeeds([]);
      setRegulatoryNeeds([]);
      setExecutionSources([]);
      setCreateOpen(false);
      void utils.project.list.invalidate();
      router.push(`/projects/${project.id}?setup=1`);
    },
    onError: (e) => setCreateError(e.message),
  });

  const updateMutation = trpcReact.project.update.useMutation({
    onSuccess: () => {
      setEditingId(null);
      void utils.project.list.invalidate();
    },
    onError: (e) => setEditError(e.message),
  });

  const deleteMutation = trpcReact.project.delete.useMutation({
    onSuccess: () => {
      setDeleteTarget(null);
      void utils.project.list.invalidate();
    },
    onError: (e) => setDeleteError(e.message),
  });

  function submit() {
    if (!orgId || !canEdit) return;
    setCreateError(null);
    createMutation.mutate({
      organizationId: orgId,
      name,
      qualityProfile: {
        objective,
        systemScope,
        softwareTypes,
        hardwareTypes,
        testEnvironments,
        qualityObjectives,
        complianceNeeds,
        regulatoryNeeds,
        executionSources,
      },
    });
  }

  async function startEdit(p: {
    id: string;
    name: string;
    repoUrl: string | null;
  }) {
    if (!canEdit) return;
    setEditingId(p.id);
    setEditName(p.name);
    setEditRepoUrl(p.repoUrl ?? "");
    const full = await utils.project.byId.fetch({ id: p.id });
    setEditDefaultBranch(full.defaultBranch);
  }

  function saveEdit() {
    if (!editingId || !canEdit) return;
    setEditError(null);
    updateMutation.mutate({
      id: editingId,
      name: editName,
      repoUrl: editRepoUrl || undefined,
      defaultBranch: editDefaultBranch,
    });
  }

  function removeProject() {
    if (!deleteTarget || !canDelete) return;
    setDeleteError(null);
    deleteMutation.mutate({ id: deleteTarget.id });
  }

  const loading = orgsQuery.isLoading || (!!orgId && projectsQuery.isLoading);
  const pageError =
    orgsQuery.error?.message ?? projectsQuery.error?.message ?? null;

  function retryPageLoad() {
    void orgsQuery.refetch();
    if (orgId) void projectsQuery.refetch();
  }

  if (loading)
    return (
      <div className="workspace-loading" role="status">
        <span className="loading-indicator" aria-hidden="true" />
        <p>Loading your projects…</p>
      </div>
    );
  if (pageError)
    return <RecoveryMessage error={pageError} onRetry={retryPageLoad} />;
  if (!orgId)
    return (
      <div className="workspace-loading" role="status">
        <p>
          Preparing your workspace. If you are not redirected, continue to{" "}
          <Link href="/onboarding">onboarding</Link>.
        </p>
      </div>
    );

  return (
    <div className="quality-workspace">
      <PageHeading
        eyebrow={`WORKSPACE / ${orgName.toUpperCase()}`}
        title="Projects"
        description="Move from test design to release evidence in one traceable workspace."
        actions={
          canEdit ? (
            <button className="btn-primary" onClick={() => setCreateOpen(true)}>
              <Icon name="folder" size={16} /> New project
            </button>
          ) : undefined
        }
      />

      {deleteError && (
        <p className="text-error" role="alert">
          {deleteError}
        </p>
      )}

      <ul className="project-grid">
        {projects.map((p) => (
          <li key={p.id} className="project-card">
            <div className="project-card-heading">
              <span className="project-symbol">
                <Icon name="folder" size={21} />
              </span>
              <Link className="text-button" href={`/projects/${p.id}`}>
                Open <Icon name="arrow" size={14} />
              </Link>
            </div>
            <h2>
              <Link href={`/projects/${p.id}`}>{p.name}</Link>
            </h2>
            <p className="project-repository">
              <Icon name="branch" size={14} />
              {p.repoUrl
                ? `Legacy reference: ${p.repoUrl}`
                : "Manage repository access from project overview"}
            </p>
            <nav
              className="project-card-links"
              aria-label={`${p.name} sections`}
            >
              <Link href={`/projects/${p.id}/test-cases`}>Test cases</Link>
              <Link href={`/projects/${p.id}/test-plans`}>Test plans</Link>
              <Link href={`/projects/${p.id}/requirements`}>Requirements</Link>
            </nav>
            {(canEdit || canDelete) && (
              <div className="project-card-admin">
                {canEdit && (
                  <button
                    className="btn-secondary"
                    onClick={() => void startEdit(p)}
                  >
                    Edit
                  </button>
                )}
                {canDelete && (
                  <button
                    className="btn-secondary"
                    onClick={() => setDeleteTarget({ id: p.id, name: p.name })}
                  >
                    Delete
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {projects.length === 0 && (
        <section className="workspace-panel">
          <EmptyState
            title={
              canEdit
                ? "Create your first project"
                : "No projects are available yet"
            }
            action={
              canEdit ? (
                <button
                  className="btn-primary"
                  onClick={() => setCreateOpen(true)}
                >
                  New project
                </button>
              ) : undefined
            }
          >
            {canEdit
              ? "Projects keep cases, CI evidence, reviews, and release decisions connected."
              : "An organization owner, admin, or editor can create the first project."}
          </EmptyState>
        </section>
      )}

      <Modal
        open={canEdit && createOpen}
        onClose={() => setCreateOpen(false)}
        title="Set up a project"
      >
        <CreationWizard
          step={createStep}
          steps={[
            "Purpose",
            "System",
            "Quality goals",
            "Obligations",
            "Review",
          ]}
          title={
            [
              "What are you validating?",
              "Describe the system and test environment",
              "What must this project prove?",
              "What obligations should be investigated?",
              "Review the workspace setup",
            ][createStep]!
          }
          description={
            [
              "This context lets Vaettir recommend useful templates instead of opening an empty software-only project.",
              "Choose everything that applies. Mixed hardware and software programs can use both sets of fields.",
              "Vaettir will recommend evidence and framework starters from these goals.",
              "Regulatory applicability depends on jurisdiction and use. Select areas to investigate, not a compliance claim.",
              "Nothing is locked in. The profile remains editable as the program changes.",
            ][createStep]
          }
          canContinue={
            createStep === 0
              ? Boolean(name.trim())
              : createStep === 1
                ? testEnvironments.length > 0
                : true
          }
          validationMessage={
            createStep === 0
              ? !name.trim()
                ? "Enter a project name to continue."
                : undefined
              : createStep === 1 && testEnvironments.length === 0
                ? "Choose at least one test environment to continue."
                : undefined
          }
          onInvalid={() => {
            if (createStep === 0) {
              document.getElementById("new-project-name")?.focus();
            } else if (createStep === 1) {
              document
                .querySelector<HTMLButtonElement>(
                  "#new-project-test-environments button",
                )
                ?.focus();
            }
          }}
          busy={createMutation.isPending}
          submitLabel="Create configured project"
          onStepChange={setCreateStep}
          onCancel={() => setCreateOpen(false)}
          onSubmit={submit}
        >
          {createStep === 0 && (
            <>
              <label>
                Project name
                <input
                  id="new-project-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                  required
                />
              </label>
              <label>
                Objective (optional)
                <textarea
                  id="new-project-objective"
                  value={objective}
                  onChange={(e) => setObjective(e.target.value)}
                  rows={3}
                  maxLength={1000}
                  aria-describedby="new-project-objective-help"
                  placeholder="For example: prove a medical-device controller and its mobile app are safe and ready for pilot production."
                />
              </label>
              <p id="new-project-objective-help" className="text-muted">
                Add what you know, or leave this blank. You can revisit your
                objective in Update project understanding later.
              </p>
              {!objective.trim() && (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={createMutation.isPending || !name.trim()}
                  onClick={() => setCreateStep(1)}
                >
                  Not sure yet · continue without an objective
                </button>
              )}
              <WizardChoices
                title="Project scope"
                options={[
                  "Software",
                  "Hardware",
                  "Integrated hardware + software",
                  "Process / laboratory",
                ]}
                selected={[
                  {
                    SOFTWARE: "Software",
                    HARDWARE: "Hardware",
                    BOTH: "Integrated hardware + software",
                    PROCESS: "Process / laboratory",
                  }[systemScope],
                ]}
                single
                onToggle={(option) =>
                  setSystemScope(
                    (
                      {
                        Software: "SOFTWARE",
                        Hardware: "HARDWARE",
                        "Integrated hardware + software": "BOTH",
                        "Process / laboratory": "PROCESS",
                      } as const
                    )[option]!,
                  )
                }
              />
            </>
          )}
          {createStep === 1 && (
            <>
              {(systemScope === "SOFTWARE" || systemScope === "BOTH") && (
                <WizardChoices
                  title="Software"
                  options={SOFTWARE_TYPES}
                  selected={softwareTypes}
                  onToggle={(item) =>
                    setSoftwareTypes((values) => toggleValue(values, item))
                  }
                />
              )}
              {(systemScope === "HARDWARE" || systemScope === "BOTH") && (
                <WizardChoices
                  title="Hardware"
                  options={HARDWARE_TYPES}
                  selected={hardwareTypes}
                  onToggle={(item) =>
                    setHardwareTypes((values) => toggleValue(values, item))
                  }
                />
              )}
              <WizardChoices
                id="new-project-test-environments"
                title="Test environments"
                options={TEST_ENVIRONMENTS}
                selected={testEnvironments}
                onToggle={(item) =>
                  setTestEnvironments((values) => toggleValue(values, item))
                }
              />
              <p className="text-muted">
                After creating the project, Add sources opens with provider
                options. Only configured providers can verify access; references
                remain unverified.
              </p>
            </>
          )}
          {createStep === 2 && (
            <>
              <WizardChoices
                title="Quality objectives"
                options={QUALITY_OBJECTIVES}
                selected={qualityObjectives}
                onToggle={(item) =>
                  setQualityObjectives((values) => toggleValue(values, item))
                }
              />
              <WizardChoices
                title="Evidence sources"
                options={EXECUTION_SOURCES}
                selected={executionSources}
                onToggle={(item) =>
                  setExecutionSources((values) => toggleValue(values, item))
                }
              />
            </>
          )}
          {createStep === 3 && (
            <>
              <WizardChoices
                title="Regulatory areas to investigate"
                options={REGULATORY_AREAS}
                selected={regulatoryNeeds}
                onToggle={(item) =>
                  setRegulatoryNeeds((values) => toggleValue(values, item))
                }
              />
              <WizardChoices
                title="Standards and control frameworks to review"
                options={COMPLIANCE_OPTIONS}
                selected={complianceNeeds}
                onToggle={(item) =>
                  setComplianceNeeds((values) => toggleValue(values, item))
                }
              />
            </>
          )}
          {createStep === 4 && (
            <div className="panel" style={{ padding: 16 }}>
              <strong>{name}</strong>
              <p style={{ margin: "5px 0" }}>
                Objective: {objective.trim() ? objective : "Not specified yet"}
              </p>
              <p className="text-muted" style={{ margin: 0, fontSize: 12 }}>
                {systemScope.replaceAll("_", " ")} ·{" "}
                {testEnvironments.join(", ") || "No environment selected"}
              </p>
              <p
                className="text-muted"
                style={{ margin: "5px 0 0", fontSize: 12 }}
              >
                {qualityObjectives.length} quality objective(s) ·{" "}
                {complianceNeeds.length} assurance need(s) ·{" "}
                {regulatoryNeeds.length} regulatory area(s) to investigate ·{" "}
                {executionSources.length} evidence source(s)
              </p>
            </div>
          )}
          {createError && (
            <p className="text-error" role="alert">
              {createError}
            </p>
          )}
        </CreationWizard>
      </Modal>

      <Modal
        open={canEdit && editingId !== null}
        onClose={() => setEditingId(null)}
        title="Edit project"
      >
        <div className="form-stack">
          <label>
            Project name
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
            />
          </label>
          <label>
            Legacy repository URL reference (access not verified)
            <input
              value={editRepoUrl}
              onChange={(e) => setEditRepoUrl(e.target.value)}
            />
          </label>
          <label>
            Default branch
            <input
              value={editDefaultBranch}
              onChange={(e) => setEditDefaultBranch(e.target.value)}
            />
          </label>
          <div className="form-actions">
            <button
              className="btn-secondary"
              onClick={() => setEditingId(null)}
            >
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={saveEdit}
              disabled={updateMutation.isPending || !editName}
            >
              {updateMutation.isPending ? "Saving…" : "Save"}
            </button>
          </div>
          {editError && (
            <p className="text-error" role="alert">
              {editError}
            </p>
          )}
        </div>
      </Modal>

      {canDelete && deleteTarget && (
        <ConfirmAction
          title={`Delete ${deleteTarget.name}?`}
          requiredText={deleteTarget.name}
          confirmLabel="Delete project"
          busy={deleteMutation.isPending}
          error={deleteError}
          onClose={() => {
            if (!deleteMutation.isPending) setDeleteTarget(null);
          }}
          onConfirm={removeProject}
        >
          <p>
            This permanently removes the project and its Vaettir records. This
            action cannot be undone.
          </p>
        </ConfirmAction>
      )}
    </div>
  );
}
