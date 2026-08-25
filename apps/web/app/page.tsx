export default function HomePage() {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 10 }}>
        VAETTIR <span className="accent">/ VAY-tir /</span>
      </div>
      <h1>Every place has its guardians.</h1>
      <p className="text-muted" style={{ maxWidth: 560 }}>
        Quality intelligence and test case management: unit, functional, contract,
        instrumentation, smoke, sanity, and compliance test plans in one place, plus AI
        reverse-engineering of automated tests into readable BDD test cases.
      </p>

      <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
        <a className="btn-primary" href="/projects">
          Go to projects
        </a>
        <a className="btn-secondary" href="/reverse-engineer">
          Reverse-engineer a test file
        </a>
      </div>
    </div>
  );
}
