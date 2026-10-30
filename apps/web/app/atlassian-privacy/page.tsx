export const metadata={title:"Atlassian connection privacy | Vaettir",description:"How Vaettir handles the optional Jira and Confluence connection."};

// Owner-review draft. Public release requires the approved notice receipt.
export default function AtlassianPrivacyPage(){
  return <article className="workspace-panel" style={{maxWidth:800,margin:"24px auto",padding:"clamp(20px, 4vw, 48px)",lineHeight:1.7,overflowWrap:"anywhere"}}>
    <header><p className="eyebrow">Vaettir · Atlassian data</p><h1>Vaettir Atlassian connection privacy</h1>
      <p>Vaettir is operated by Skald and Stone LLC. This notice describes the optional Jira Cloud and Confluence Cloud connection. It supplements the notices for other Vaettir features.</p></header>
    <section><h2>Access and selection</h2>
      <p>Connecting opens Atlassian&apos;s sign-in and consent page. The connection requests read access to account identity, Jira work and users, and Confluence space metadata, together with renewable authorization. Atlassian&apos;s permission descriptions can cover more data than a particular Vaettir screen uses. Vaettir does not request permission to change Jira issues or Confluence content through this connection.</p>
      <p>The connection is restricted to the Atlassian site selected during authorization. Vaettir then lists available Jira projects or Confluence spaces. The customer reviews and chooses the resources to link to the current Vaettir project. A connection belongs to its authorizing Vaettir user, workspace and project; it is not an unrestricted credential shared across customers.</p></section>
    <section><h2>Information used and retained</h2>
      <p>Vaettir stores the authorizing Atlassian account identifier and display name, site identifiers and addresses, selected resource identifiers and names, connection status, approval receipts and verification times. Initial connection checks retrieve account and resource metadata. They do not import Jira issue content or Confluence pages.</p>
      <p>Access and refresh credentials are encrypted in Vaettir&apos;s database. Refresh authorization allows the connection to renew while it remains authorized. Vaettir&apos;s hosted application and database infrastructure process these records. Credentials are not displayed in project documents or sent to an AI provider by the connection flow.</p>
      <p>Any separate content import or analysis has its own review and approval controls. Connecting alone does not authorize AI analysis or AI-plugin access to project content. Imported content, its source references and retained project history are governed by the relevant Vaettir feature and project access controls.</p></section>
    <section><h2>Disconnecting and deletion</h2>
      <p>Disconnecting in Vaettir stops use of the connection and clears its usable credentials. An exchange or refresh already in progress is denied permission to restore a disconnected connection. Disconnecting does not revoke Atlassian&apos;s own app authorization: that can be removed at <a href="https://id.atlassian.com/manage-profile/apps" target="_blank" rel="noopener noreferrer">Atlassian connected apps</a>.</p>
      <p>Connection metadata and approval history can remain after disconnection. Disconnecting or revoking access does not delete previously imported project content or its history. Contact james@skaldandstone.com for access, correction or deletion requests. Any retained backup and audit information must be considered when handling such a request; this notice does not promise immediate deletion from backups or a fixed retention period.</p></section>
    <section><h2>Contact</h2><p>Questions about this connection or its data: <a href="mailto:james@skaldandstone.com">james@skaldandstone.com</a>.</p></section>
  </article>;
}
