import { SignIn } from "@clerk/nextjs";
import Link from "next/link";

export default function SignInPage() {
  return (
    <div className="auth-workspace">
      <div className="auth-introduction">
        <p className="workspace-breadcrumb">VAETTIR / PRIVATE BETA</p>
        <h1>Back to your workspace</h1>
        <p>
          Sign in with the email your team invited. Your projects and
          permissions will follow your account.
        </p>
        <Link href="/">Explore the example workspace</Link>
        <Link href="/beta-guide">
          Invitation or access trouble? Read the beta guide
        </Link>
      </div>
      <div className="auth-form">
        <SignIn />
        <p className="auth-help">
          If the sign-in form does not load, check your connection and reload
          this page. Never share a sign-in code with support.
        </p>
      </div>
    </div>
  );
}
