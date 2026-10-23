import Link from "next/link";
import { Icon } from "../../components/ui/Workspace";

export default function BetaGuidePage() {
  return (
    <div className="guide-workspace">
      <header className="guide-hero">
        <p className="workspace-breadcrumb">VAETTIR DEMO ACCESS</p>
        <h1>Explore freely without exposing protected workspaces.</h1>
        <p>Anyone can create an account and use the sales demo. Customer data and advanced capabilities stay behind explicit workspace access.</p>
        <div className="guide-actions">
          <Link className="btn-primary" href="/sign-up">Create demo account</Link>
          <Link className="btn-secondary" href="/sign-in">Sign in</Link>
          <Link className="btn-secondary" href="/">Back to Vaettir</Link>
        </div>
      </header>

      <section className="guide-grid" aria-label="Beta access paths">
        <article className="workspace-panel guide-card">
          <span className="onboarding-icon"><Icon name="book" size={22} /></span>
          <p className="eyebrow accent">Sales demo</p>
          <h2>Explore without a workspace</h2>
          <p>Sign up with Google or email to review the guided Vaettir example. Demo accounts cannot retrieve customer data, create organizations, run AI actions, configure integrations, or administer seats.</p>
        </article>
        <article className="workspace-panel guide-card">
          <span className="onboarding-icon"><Icon name="people" size={22} /></span>
          <p className="eyebrow accent">Workspace owner</p>
          <h2>Create a new workspace</h2>
          <p>Full workspace creation is reserved for the explicitly approved owner account. Access is checked server-side before onboarding can create an organization.</p>
        </article>
        <article className="workspace-panel guide-card">
          <span className="onboarding-icon"><Icon name="arrow" size={22} /></span>
          <p className="eyebrow accent">Teammate</p>
          <h2>Join an existing workspace</h2>
          <p>Open the unique invitation link sent by your workspace owner. Sign in with the same email address as the invitation, then review the role and seat before accepting.</p>
        </article>
      </section>

      <section className="workspace-panel guide-boundaries">
        <div>
          <p className="eyebrow">Before you upload</p>
          <h2>Private-beta data boundaries</h2>
        </div>
        <ul>
          <li>Use non-regulated project data and test code only.</li>
          <li>Do not upload secrets, credentials, or regulated personal data.</li>
          <li>AI features send the submitted case or review context to the configured AI provider. Only use content your team is allowed to share for processing.</li>
          <li>The beta includes 500 non-rolling AI credits per team each month, with no automatic overage charges.</li>
        </ul>
      </section>

      <p className="guide-support">Still blocked? Reply to the person who invited you and include the email shown on the onboarding screen. Do not send passwords, API keys, or customer data.</p>
    </div>
  );
}
