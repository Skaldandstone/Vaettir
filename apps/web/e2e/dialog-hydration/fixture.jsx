import { useState } from "react";
import { DialogFrame } from "../../components/ui/DialogFrame";

let nextOwner = 0;
function OwnedDraft() {
  const [owner] = useState(() => String(++nextOwner));
  const [draft, setDraft] = useState("");
  return <label>Retained draft
    <input data-dialog-initial-focus data-owner={owner} value={draft}
      onChange={event => setDraft(event.target.value)} />
  </label>;
}

export function HydrationFixture() {
  const [open, setOpen] = useState(false);
  return <>
    <h1>Retained dialog hydration</h1>
    <button onClick={() => setOpen(true)}>Open retained draft</button>
    <DialogFrame open={open} onClose={() => setOpen(false)} keepMounted
      className="fixture-dialog" label="Retained draft dialog">
      <OwnedDraft />
    </DialogFrame>
  </>;
}
