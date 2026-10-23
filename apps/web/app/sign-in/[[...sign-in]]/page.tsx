import { SignIn } from "@clerk/nextjs";
import Link from "next/link";

export default function SignInPage() {
  return (
    <div className="auth-workspace">
      <section className="auth-introduction">
        <p className="workspace-breadcrumb">VAETTIR / PRIVATE BETA</p>
        <h1>Welcome back to your quality workspace.</h1>
        <p>Review cases, connect execution evidence, and keep every release decision explainable.</p>
        <Link href="/">Explore the example workspace</Link>
      </section>
      <div className="auth-form">
        <SignIn />
        <p className="auth-help">Anyone can sign in to the sales demo. Protected workspaces and advanced features require explicit access.</p>
      </div>
    </div>
  );
}
