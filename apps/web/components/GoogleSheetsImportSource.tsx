"use client";

import { useEffect, useRef, useState } from "react";
import { trpcReact } from "@/lib/trpcReact";
import { GOOGLE_SHEETS_SCOPE, GOOGLE_SHEET_MIME, readSheetBook, readSheetSnapshot, sheetId, validSheetToken, type GoogleSheetSnapshot, type SheetBook } from "@/lib/google-sheets-import";

type TokenResponse = { access_token?: string; scope?: string; expires_in?: number | string; error?: string };
interface Picker { setVisible(visible: boolean): void; dispose(): void }
interface PickerBuilder {
  addView(view: unknown): PickerBuilder; setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder; setAppId(id: string): PickerBuilder;
  setOrigin(origin: string): PickerBuilder;
  setCallback(callback: (data: { action: string; docs?: { id?: string; mimeType?: string }[] }) => void): PickerBuilder;
  build(): Picker;
}
interface GoogleRuntime {
  google: {
    accounts: { oauth2: { initTokenClient(config: {
      client_id: string; scope: string; include_granted_scopes: boolean;
      callback(response: TokenResponse): void; error_callback(): void;
    }): { requestAccessToken(options: { prompt: string }): void } } };
    picker: { DocsView: new () => { setMimeTypes(mime: string): unknown }; PickerBuilder: new () => PickerBuilder };
  };
  gapi: { load(name: string, options: { callback(): void; onerror(): void; timeout: number; ontimeout(): void }): void };
}
let libraries: Promise<void> | undefined;
function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src; script.async = true; script.referrerPolicy = "no-referrer";
    const timer = setTimeout(() => { script.remove(); reject(new Error("Google did not finish loading. Try again.")); }, 15000);
    script.onload = () => { clearTimeout(timer); resolve(); };
    script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error("Google could not load. Check your connection.")); };
    document.head.append(script);
  });
}
function loadGoogle() {
  libraries ??= Promise.all([loadScript("https://accounts.google.com/gsi/client"), loadScript("https://apis.google.com/js/api.js")])
    .then(() => new Promise<void>((resolve, reject) => {
      (window as unknown as GoogleRuntime).gapi.load("picker", { callback: resolve, onerror: () => reject(new Error("Google Picker could not load.")), timeout: 15000, ontimeout: () => reject(new Error("Google Picker timed out.")) });
    })).catch(error => { libraries = undefined; throw error; });
  return libraries;
}

export function GoogleSheetsImportSource({ projectId, disabled, onSnapshots }: {
  projectId: string; disabled: boolean; onSnapshots(snapshots: GoogleSheetSnapshot[]): Promise<void>;
}) {
  const config = trpcReact.importJobs.googleSheetsConfig.useQuery({ projectId }, { refetchOnWindowFocus: false });
  const [ready, setReady] = useState(false);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [book, setBook] = useState<SheetBook | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const current = useRef<AbortController | null>(null);
  const credential = useRef<{ token: string; expires: number } | null>(null);
  const picker = useRef<Picker | null>(null);
  const expiry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function clearAccess() {
    current.current?.abort(); current.current = null;
    credential.current = null;
    clearTimeout(expiry.current);
    picker.current?.dispose(); picker.current = null;
  }
  useEffect(() => () => { clearAccess(); }, [projectId]);
  function cancel() {
    clearAccess(); setBook(null); setSelected([]); setBusy(false); setApproved(false); setError(null);
  }
  async function prepare() {
    setBusy(true); setError(null);
    try { await loadGoogle(); setReady(true); }
    catch { setError("Google could not finish loading. Check your connection and try again."); }
    finally { setBusy(false); }
  }
  // Called directly by the customer's click, preserving Google's popup gesture.
  function authorize() {
    if (!config.data || !approved || disabled) return;
    clearAccess(); setBook(null); setSelected([]); setError(null); setBusy(true);
    const operation = new AbortController(); current.current = operation;
    const google = (window as unknown as GoogleRuntime).google;
    const fail = () => {
      if (operation.signal.aborted) return;
      clearAccess(); setBusy(false); setBook(null); setError("Google could not complete the selection. Check your access or authorize again.");
    };
    try {
      google.accounts.oauth2.initTokenClient({
        client_id: config.data.clientId, scope: GOOGLE_SHEETS_SCOPE, include_granted_scopes: false,
        error_callback: fail,
        callback: response => {
          if (operation.signal.aborted) return;
          try {
            const token = validSheetToken(response);
            const lifetime = Math.min(Number(response.expires_in), 3600) * 1000 - 30000;
            credential.current = { token, expires: Date.now() + lifetime };
            expiry.current = setTimeout(() => { if (!operation.signal.aborted) { clearAccess(); setBook(null); setBusy(false); setError("Google access expired. Authorize again to choose your sheet."); } }, lifetime);
            const view = new google.picker.DocsView().setMimeTypes(GOOGLE_SHEET_MIME);
            picker.current = new google.picker.PickerBuilder().addView(view)
              .setOAuthToken(token).setDeveloperKey(config.data!.apiKey).setAppId(config.data!.appId)
              .setOrigin(window.location.origin).setCallback(data => {
                if (operation.signal.aborted) return;
                if (data.action === "cancel") { cancel(); return; }
                if (data.action !== "picked") return;
                void (async () => {
                  if (data.docs?.length !== 1 || data.docs[0]?.mimeType !== GOOGLE_SHEET_MIME) throw new Error("Invalid selection");
                  const id = sheetId(data.docs[0].id);
                  picker.current?.dispose(); picker.current = null;
                  const selectedBook = await readSheetBook(id, token, operation.signal);
                  if (operation.signal.aborted) return;
                  setBook(selectedBook); setSelected(selectedBook.tabs.slice(0, 20).map(tab => tab.id)); setBusy(false);
                })().catch(fail);
              }).build();
            picker.current.setVisible(true);
          } catch { fail(); }
        },
      }).requestAccessToken({ prompt: "consent select_account" });
    } catch { fail(); }
  }
  async function preview() {
    const access = credential.current;
    const operation = current.current;
    const tabs = book?.tabs.filter(item => selected.includes(item.id)) ?? [];
    if (!access || access.expires <= Date.now() || !operation || !book || !tabs.length) { cancel(); setError("Authorize again and choose at least one worksheet."); return; }
    setBusy(true); setError(null);
    try {
      const snapshots: GoogleSheetSnapshot[] = [];
      let bytes = 0;
      for (const tab of tabs) {
        const snapshot = await readSheetSnapshot(book, tab, access.token, operation.signal);
        if (operation.signal.aborted) return;
        bytes += new TextEncoder().encode(snapshot.csvText).length;
        if (bytes > 1024 * 1024) throw new Error("Selected worksheets exceed 1 MiB. Choose fewer tabs.");
        snapshots.push(snapshot);
      }
      // Discard provider access before sending the selected content for mapping.
      clearAccess(); setBook(null); setSelected([]); setApproved(false);
      await onSnapshots(snapshots);
    } catch (failure) {
      if (!operation.signal.aborted) { clearAccess(); setBook(null); setError(failure instanceof Error ? failure.message : "The selected sheets could not be read."); }
    } finally { if (current.current === operation || current.current === null) setBusy(false); }
  }
  return <section aria-label="Import from Google Sheets" style={{ marginTop: 12 }}>
    <h3>Import from Google Sheets</h3>
    <p>Connect Google, choose a spreadsheet and up to 20 tabs, then review the automatically mapped fields. Nothing is saved until you confirm the import.</p>
    <details><summary>Google access and import privacy</summary><p className="text-muted">Google’s selected-file permission allows viewing and managing files chosen for this app. Vaettir uses it only to read your selection. The temporary token stays in this browser and is discarded after the read; Google’s app permission remains until you revoke it in your Google account. This is a manual import, without automatic sync or AI analysis.</p><p>Use column names in the first row. Each case needs a unique ID column, such as Case ID, so repeating an import updates the same cases safely. Keep these IDs unchanged. Reloading this page discards the preview and temporary connection.</p></details>
    {config.isLoading ? <p role="status">Checking Google Sheets availability…</p> : config.error ? <p role="alert">Could not check Google Sheets availability. Try reloading this page.</p> : !config.data ? <p role="status">Google Sheets connection is awaiting administrator setup. You can download your sheet as CSV or Excel and use “Upload an export” now.</p> : <>
      <label><input type="checkbox" checked={approved} disabled={busy || disabled} onChange={event => setApproved(event.target.checked)} /> I approve reading the spreadsheet I select and sending the selected worksheet to this Vaettir project for import review.</label>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        {!ready ? <button type="button" disabled={!approved || busy || disabled} onClick={() => void prepare()}>Load Google connection</button> : !book ? <button type="button" disabled={!approved || busy || disabled} onClick={authorize}>Authorize Google and choose a spreadsheet</button> : null}
        {(busy || book) && <button type="button" className="btn-secondary" onClick={cancel}>Cancel Google selection</button>}
      </div>
      {busy && <p role="status">Waiting for Google or reading your selection…</p>}
      {book && <div style={{ marginTop: 12, overflowWrap: "anywhere" }}><strong>{book.title}</strong>
        <div style={{ display: "flex", gap: 8, margin: "8px 0" }}><button type="button" className="btn-secondary" disabled={busy || disabled} onClick={() => setSelected(book.tabs.slice(0, 20).map(tab => tab.id))}>Select {book.tabs.length > 20 ? "first 20" : "all"}</button><button type="button" className="btn-secondary" disabled={busy || disabled} onClick={() => setSelected([])}>Deselect all</button></div>
        <fieldset disabled={busy || disabled} style={{ maxHeight: 250, overflowY: "auto" }}><legend>Worksheets · {selected.length} selected</legend>{book.tabs.map(tab => <label key={tab.id} style={{ display: "block", margin: "8px 0" }}><input type="checkbox" checked={selected.includes(tab.id)} disabled={!selected.includes(tab.id) && selected.length >= 20} onChange={event => setSelected(current => event.target.checked ? [...current, tab.id] : current.filter(id => id !== tab.id))} /> {tab.title} <small className="text-muted">{tab.rows.toLocaleString()} allocated rows</small></label>)}</fieldset>
        <button type="button" disabled={busy || disabled || !approved || !selected.length} onClick={() => void preview()}>Read selected tabs and preview</button></div>}
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
