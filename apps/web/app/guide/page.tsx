import Link from "next/link";

const topics = [
  {
    id: "import", label: "Imports", title: "Import test cases", steps: [
      "Open Import in your project and choose a spreadsheet or supported file.",
      "Check the suggested column mapping, especially the case title and expected result.",
      "Import ready rows. Open the mapping queue to resolve rows that need your input.",
    ],
  },
  {
    id: "jira-plans", label: "Jira plans", title: "Plan a Jira release", steps: [
      "Connect Jira in Integrations and approve the Jira project you want to use.",
      "In Test Plans, choose a Jira release and select Read tickets. Vaettir reads descriptions to find acceptance criteria.",
      "Open tickets to review acceptance checks and select relevant case matches. Add coverage for tickets with gaps.",
      "Select Create plan to save a draft. Use Configure cases to choose how to run it.",
    ],
  },
  {
    id: "defects", label: "Defects", title: "Review Jira defects", steps: [
      "Open Defect map and connect Jira.",
      "Select the project and issue type. Add labels to narrow the results.",
      "Read the preview, choose issue summaries, then review and save them.",
    ],
  },
  {
    id: "runs", label: "Test runs", title: "Run tests and report", steps: [
      "Open a plan and use Configure cases to choose cases and a run configuration.",
      "Select Run plan and record the outcome and evidence for each case.",
      "Open Reports to review results and choose what to share.",
    ],
  },
  {
    id: "credits", label: "AI credits", title: "Check AI credits", steps: [
      "Open Organization settings to see your balance and monthly allowance.",
      "Look for the credit cost next to the AI action before running it.",
    ],
  },
  {
    id: "cases", label: "Test cases", title: "Write and organize cases", steps: [
      "Open Test Cases to create a case, import cases or browse suites.",
      "If a new case save is unconfirmed, select Retry. Your original draft stays unchanged until the result is confirmed.",
      "Describe the starting conditions, actions and expected results. Use steps or Given, When and Then.",
      "Add tags to connect related cases. Jira planning matches issue keys, labels and component names against these tags.",
      "Use suggestions to review suite, subsuite, priority and test-type changes before applying them.",
      "Open the review queue for pending cases. Keep a review open until its decision is saved.",
      "Use parameters for repeated tests. Each dataset row supplies one set of values and starts a separate run.",
      "Prerequisites are checked separately in every dataset row.",
    ],
  },
  {
    id: "plans", label: "Plans", title: "Build a test plan", steps: [
      "Create a plan and choose its type. Functional works for ordinary feature testing.",
      "Add acceptance criteria with a clear expected outcome.",
      "Configure cases to choose the tests and run context. Review any missing coverage.",
      "Use a QA strategy to describe the scope, risks, environments, entry checks and exit checks.",
      "A quality review suggests improvements. Review and edit those suggestions before saving.",
    ],
  },
  {
    id: "requirements", label: "Requirements", title: "Connect requirements to evidence", steps: [
      "Write the required behavior, then link cases that verify it.",
      "Use Requirement coverage to inspect linked cases and their recorded results. A link alone does not show that a test passed.",
      "Save a baseline before a significant change. Compare wording and case links with the saved baseline afterward.",
      "Review affected tests when a requirement changes.",
    ],
  },
  {
    id: "compliance", label: "Compliance", title: "Map compliance controls", steps: [
      "Choose a framework and open a control’s mapping guide.",
      "Map tests with explicit actions and expected results for the control. Include failure or refusal behavior where relevant.",
      "Review the executed version, scope, date, actual result and deviations. Organizational controls may also need documents or a human review.",
      "Record the review period and request sign-off from an auditor, admin or owner.",
      "To import controls, use CSV columns code, title and optional description. Existing codes are retained.",
    ],
  },
  {
    id: "releases", label: "Releases", title: "Review a release", steps: [
      "Create a release or choose a connected Jira or repository release.",
      "Add plans and acceptance criteria, then review test results and open risks.",
      "Choose whether unresolved criteria and critical risks warn or block readiness in Organization settings.",
      "Link a Jira version and select the runs that validate it.",
      "Subscribers receive readiness-status changes. Review a release summary before sharing it.",
    ],
  },
  {
    id: "reports", label: "Reports", title: "Create and share reports", steps: [
      "Open Reports and choose the tests, dates and configuration you want to include.",
      "Review the charts, add notes and save a snapshot for a fixed record.",
      "Export the format your audience needs. HTML and PDF include charts and notes. CSV contains summary data.",
      "Execution-history exports distinguish corrections from retests. Imports with only an original date do not reconstruct step evidence.",
      "Release filters use current plan associations and selected cases; they do not reconstruct a run’s historical release membership.",
      "The run dashboard compares up to 90 inclusive UTC days using run start dates. The history-page chart covers only the runs on that page.",
      "Configure a Slack summary in Organization settings if your team wants regular release updates.",
    ],
  },
  {
    id: "exploration", label: "Exploration", title: "Explore without scripted steps", steps: [
      "Create a session with a charter describing what you want to learn.",
      "Explore the app and record findings as you go.",
      "Turn useful findings into cases with reproducible actions and expected results.",
    ],
  },
  {
    id: "live-apps", label: "Live apps", title: "Explore and replay an app", steps: [
      "For Android, attach a test device to the computer running the connector. Install Node 22 and ADB first.",
      "Open the unsigned launcher only if your device policy permits, then check its paired response in Vaettir.",
      "Choose the test app and device. Approve only ordinary navigation in a test account.",
      "Review the exploration scope and start. Search and filter fields stay untouched. An active action may finish after you pause or stop.",
      "Review the reached paths and expected business behavior before adding proposed cases.",
      "Replay supports taps and exact visible-label checks using app selectors. App API evidence requires the debug integration configured by your team.",
      "Review technical evidence before adding it to a case. Saving a changed procedure creates a new version and returns the case to review.",
      "Web and iOS capture tools and the Unreal preview have their own setup and available actions on the Live App page.",
    ],
  },
  {
    id: "automation", label: "Automation", title: "Connect source and generate automation", steps: [
      "Connect a repository, then review which files Vaettir may read and the credit estimate.",
      "Gherkin scenarios import directly. Scenario Outline examples become separate cases.",
      "Postman import reads requests with test assertions. Requests without tests are skipped.",
      "For a custom framework, provide two or three example files that show test names, assertions and setup.",
      "Open a reviewed case to generate framework-specific source. Review and run the draft in your own environment.",
    ],
  },
  {
    id: "integrations", label: "Connections", title: "Connect project tools", steps: [
      "Open Integrations in your project and choose the provider.",
      "Sign in with your existing provider account and choose the projects, spaces, repositories or files to approve.",
      "Connecting a provider and approving an import are separate actions. Review the read scope before importing.",
      "In GitHub, choose the account and repositories allowed for the Vaettir App.",
      "Quality Intelligence in Jira or Confluence manages sharing Vaettir quality information back to those tools.",
      "Organization settings also contain provider-specific status-sync and webhook setup.",
    ],
  },
  {
    id: "settings", label: "Settings", title: "Manage your workspace", steps: [
      "Use Members to invite teammates and choose their role and seat.",
      "Use Access review to check each member’s access and record a decision.",
      "Set evidence retention to match your organization’s requirements.",
      "Project settings contain the project case key and project-specific options.",
    ],
  },
  {
    id: "ai-sharing", label: "AI sharing", title: "Review AI access", steps: [
      "Open AI sharing in Project integrations and review the project’s actual data.",
      "Choose Unclassified for data awaiting review, Customer proprietary for confidential business information, Regulated for protected data, or Synthetic only for fabricated test data.",
      "Review protected data separately even after redaction. Classification does not scan or sanitize content.",
      "Saving a classification revokes existing grants. Synthetic projects also require an attestation.",
      "Review the counts-only scope and expiry before approving a plugin connection. Revoke a grant from the same tab.",
      "Case analysis and source processing have their own approval prompts that identify the data and AI provider.",
    ],
  },
];

export default function GuidePage() {
  return <main className="guide-workspace">
    <header className="guide-hero">
      <h1>Vaettir guide</h1>
      <nav className="guide-actions" aria-label="Guide topics">
        {topics.map(topic => <a className="btn-secondary" href={`#${topic.id}`} key={topic.id}>{topic.label}</a>)}
      </nav>
      <Link href="/projects">Projects</Link>
    </header>
    {topics.map(topic => <section className="workspace-panel guide-card" id={topic.id} key={topic.id}>
      <h2>{topic.title}</h2>
      <ol>{topic.steps.map(step => <li key={step}>{step}</li>)}</ol>
    </section>)}
  </main>;
}
