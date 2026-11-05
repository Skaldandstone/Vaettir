import { SignIn } from "@clerk/nextjs";
import Link from "next/link";

export default function SignInPage() {
  return (
    <div className="auth-workspace">
      <section className="auth-introduction">
        <p className="workspace-breadcrumb">VAETTIR / PRIVATE BETA</p>
        <h1>Sign in</h1>
        <Link className="btn-secondary" href="/">View demo</Link>
      </section>
      <div className="auth-form">
        <SignIn />
        <p className="auth-help">Use the email your team invited.</p>
      </div>
    </div>
  );
}
