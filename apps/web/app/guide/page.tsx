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
