import { SignUp } from "@clerk/nextjs";
import Link from "next/link";

export default function SignUpPage() {
  return (
    <div className="auth-workspace">
      <section className="auth-introduction">
        <p className="workspace-breadcrumb">VAETTIR / SALES DEMO</p>
        <h1>Create account</h1>
        <Link className="btn-secondary" href="/">View demo</Link>
      </section>
      <div className="auth-form">
        <SignUp />
        <p className="auth-help">Start with the demo or join an invited workspace.</p>
      </div>
    </div>
  );
}
