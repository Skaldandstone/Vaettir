import Link from "next/link";

export default function BetaGuide() {
  return <main style={{ maxWidth: 760, margin: "40px auto", padding: 24 }}>
    <p className="eyebrow">VAETTIR PRIVATE BETA</p>
    <h1>Your first quality loop</h1>
    <p>Three invited teams. Five full seats, two read-only seats, and 500 AI credits per team each month. No payment details, automatic overages, or rollover.</p>
    <ol>
      <li>Sign in with your invited email. Owners create a workspace; teammates open their membership invitation link.</li>
      <li>Create a project on the web. Start with a small, non-sensitive test file or CSV import.</li>
      <li>Review the resulting cases before accepting them. AI suggestions never replace human review.</li>
      <li>Connect a CI service token, report a test run, and inspect the release-readiness result.</li>
      <li>Install the Android beta from your private invitation, sign in, and select the same organization and project.</li>
    </ol>
    <h2>Data boundaries</h2>
    <p>Bring only code and project information you are authorized to share. Exclude credentials, secrets, regulated personal data, and sensitive customer records. Compliance screens help organize evidence; they are not a claim that Vaettir is certified.</p>
    <p>AI actions send the selected text, source code, or relevant changes to Anthropic for processing. Review the material before choosing an AI action. Ordinary case viewing does not require an AI call.</p>
    <p>The mobile beta does not retain project data for offline viewing. Reconnect to refresh; sign out before sharing a device.</p>
    <h2>Limits and support</h2>
    <p>Pending membership invitations reserve seats. Service accounts for CI currently use a full seat. Revoke an unused invitation or service key to make room. AI requests stop when credits are exhausted; ask your beta contact for help rather than creating another account.</p>
    <p>Contact the person who invited your team, James, through the same private channel. Include the page or screen, time, app version, and steps to reproduce. Do not send passwords, tokens, source files, or unsanitized logs.</p>
    <p>Ask that contact to pause your team, export data, or request deletion. Requests are reviewed and recorded before action.</p>
    <p><Link href="/projects">Open your projects</Link></p>
  </main>;
}
