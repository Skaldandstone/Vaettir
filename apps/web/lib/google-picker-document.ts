// This fixed, content-free document is the only origin-referrer exception.
// Never interpolate a project, file, credential or query string into this HTML.
export const GOOGLE_PICKER_DOCUMENT = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="origin">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Choose a Google spreadsheet</title>
<style>body{margin:0;background:#fff;color:#17212b;font:16px system-ui}header{padding:12px;display:flex;align-items:center;justify-content:space-between;gap:12px}button{font:inherit;padding:10px 16px;cursor:pointer}p{padding:0 12px}</style></head>
<body><header><strong>Choose a Google spreadsheet</strong><button id="cancel" type="button">Cancel Google selection</button></header>
<p id="status" role="status">Loading Google Picker…</p>
<script>
(() => {
  "use strict";
  const origin = window.location.origin;
  const channel = "vaettir-google-picker-v1";
  let initialized = false, closed = false, picker = null, deadline;
  function send(action, docs) {
    if (window.parent !== window) window.parent.postMessage({ channel, action, ...(docs ? { docs } : {}) }, origin);
  }
  function finish(action, docs) {
    if (closed) return;
    closed = true; clearTimeout(deadline);
    if (picker) { picker.dispose(); picker = null; }
    window.removeEventListener("message", initialize);
    send(action, docs);
  }
  document.getElementById("cancel").onclick = () => finish("cancel");
  window.addEventListener("keydown", event => { if (event.key === "Escape") finish("cancel"); });
  window.addEventListener("pagehide", () => finish("cancel"), { once: true });
  function initialize(event) {
    if (closed || initialized || event.source !== window.parent || event.origin !== origin) return;
    const data = event.data;
    if (!data || data.channel !== channel || data.action !== "initialize") return;
    if (typeof data.token !== "string" || !/^[\x21-\x7e]{1,10000}$/.test(data.token)
        || typeof data.apiKey !== "string" || !data.apiKey || data.apiKey.length > 200
        || typeof data.appId !== "string" || !/^\d{1,30}$/.test(data.appId)
        || !Number.isFinite(data.expires) || data.expires <= Date.now() || data.expires > Date.now() + 3600000) {
      finish("error"); return;
    }
    initialized = true;
    window.removeEventListener("message", initialize);
    deadline = setTimeout(() => finish("error"), data.expires - Date.now());
    // Closure only: no URL, storage, Vaettir request or telemetry carries this.
    let token = data.token;
    const script = document.createElement("script");
    script.src = "https://apis.google.com/js/api.js";
    script.referrerPolicy = "origin";
    script.onerror = () => { token = ""; finish("error"); };
    script.onload = () => {
      if (closed) { token = ""; return; }
      try {
        window.gapi.load("picker", { timeout: 15000, onerror: () => { token = ""; finish("error"); }, ontimeout: () => { token = ""; finish("error"); }, callback: () => {
          if (closed) { token = ""; return; }
          try {
            const view = new window.google.picker.DocsView().setMimeTypes("application/vnd.google-apps.spreadsheet");
            picker = new window.google.picker.PickerBuilder().addView(view)
              .setOAuthToken(token).setDeveloperKey(data.apiKey).setAppId(data.appId).setOrigin(origin)
              .setCallback(result => {
                if (result.action === "cancel") finish("cancel");
                if (result.action === "picked") {
                  if (!Array.isArray(result.docs) || result.docs.length !== 1
                      || !/^[A-Za-z0-9_-]{1,200}$/.test(result.docs[0]?.id ?? "")
                      || result.docs[0]?.mimeType !== "application/vnd.google-apps.spreadsheet") { finish("error"); return; }
                  finish("picked", [{ id: result.docs[0].id, mimeType: result.docs[0].mimeType }]);
                }
              }).build();
            token = "";
            picker.setVisible(true);
            document.getElementById("status").textContent = "Select the spreadsheet to read.";
            send("opened");
          } catch { token = ""; finish("error"); }
        } });
      } catch { token = ""; finish("error"); }
    };
    document.head.append(script);
  }
  if (window.parent !== window) {
    window.addEventListener("message", initialize);
    send("ready");
  } else document.getElementById("status").textContent = "Open Google Sheets import from your Vaettir project.";
})();
</script></body></html>`;
