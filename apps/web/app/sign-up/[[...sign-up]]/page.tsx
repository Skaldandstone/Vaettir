import { SignUp } from "@clerk/nextjs";
import Link from "next/link";

export default function SignUpPage() {
  return (
    <div className="auth-workspace">
      <section className="auth-introduction">
        <p className="workspace-breadcrumb">VAETTIR / INVITED ACCESS</p>
        <h1>Build release confidence your team can inspect.</h1>
        <p>Create your account with the address that received your Vaettir invitation.</p>
        <Link href="/">Explore the example workspace</Link>
      </section>
      <div className="auth-form">
        <SignUp />
        <p className="auth-help">Vaettir is currently available to approved private-beta teams. Creating an account does not create a public workspace.</p>
      </div>
    </div>
  );
}
