import { SignUp } from "@clerk/nextjs";
import Link from "next/link";

export default function SignUpPage() {
  return (
    <div className="auth-workspace">
      <div className="auth-introduction">
        <p className="workspace-breadcrumb">VAETTIR / PRIVATE BETA</p>
        <h1>Join your team</h1>
        <p>
          Use the email address on your invitation. Creating an account does not
          grant access to a workspace or enroll a new team.
        </p>
        <Link href="/beta-guide">How private-beta access works</Link>
        <Link href="/">Back to the example workspace</Link>
      </div>
      <div className="auth-form">
        <SignUp />
        <p className="auth-help">
          After signing up, open your team’s invitation link to join its
          workspace.
        </p>
      </div>
    </div>
  );
}
