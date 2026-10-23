import { SignUp } from "@clerk/nextjs";
import Link from "next/link";

export default function SignUpPage() {
  return (
    <div className="auth-workspace">
      <section className="auth-introduction">
        <p className="workspace-breadcrumb">VAETTIR / SALES DEMO</p>
        <h1>Build release confidence your team can inspect.</h1>
        <p>Create an account with Google or email. Every account can explore the demo; protected workspaces require explicit access.</p>
        <Link href="/">Explore the example workspace</Link>
      </section>
      <div className="auth-form">
        <SignUp />
        <p className="auth-help">Signing up opens the sales demo. Customer data, workspace creation, AI usage, integrations, and administrative controls stay gated.</p>
      </div>
    </div>
  );
}
