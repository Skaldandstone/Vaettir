"use client";

import { workspaceNameError, normalizeWorkspaceName, workspaceHostname } from "@vaettir/core";
import { trpcReact } from "../lib/trpcReact";

export function WorkspaceAddressFields({ name, onNameChange, confirmed, onConfirmedChange, disabled = false }: {
  name: string; onNameChange: (name: string) => void;
  confirmed: boolean; onConfirmedChange: (confirmed: boolean) => void; disabled?: boolean;
}) {
  const normalized = normalizeWorkspaceName(name);
  const invalid = workspaceNameError(name);
  const availability = trpcReact.organization.domainAvailability.useQuery(
    { name: normalized }, { enabled: false, retry: false, staleTime: 0 },
  );
  const checked = availability.data?.name === normalized && !availability.isFetching;
  return (
    <fieldset disabled={disabled} className="form-stack">
      <legend>Your permanent workspace address</legend>
      <label>
        Workspace name
        <input value={name} onChange={event => { onNameChange(event.target.value); onConfirmedChange(false); }}
          autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={63}
          aria-describedby="workspace-address-preview workspace-address-policy" placeholder="your-team" required />
      </label>
      <p id="workspace-address-preview" aria-live="polite">
        {normalized ? `https://${workspaceHostname(normalized)}` : "https://your-team.vaettir.app"}
      </p>
      {name && invalid && <p role="alert">{invalid}</p>}
      <button type="button" className="btn-secondary" disabled={Boolean(invalid) || availability.isFetching}
        onClick={() => { onConfirmedChange(false); void availability.refetch(); }}>
        {availability.isFetching ? "Checking…" : "Check availability"}
      </button>
      {checked && <p role="status">{availability.data?.available ? "This address is available. Review it before confirming." : "This address is unavailable. Choose another name."}</p>}
      {availability.error && <p role="alert">Availability could not be checked. Try again.</p>}
      <p id="workspace-address-policy">You can choose this address once. After confirmation, you cannot rename it in settings. You can change your company display name later.</p>
      <label>
        <input type="checkbox" checked={confirmed} disabled={!checked || !availability.data?.available || Boolean(invalid) || Boolean(availability.error)}
          onChange={event => onConfirmedChange(event.target.checked)} required />
        I confirm this permanent workspace address.
      </label>
    </fieldset>
  );
}
