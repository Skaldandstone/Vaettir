import { GOOGLE_SHEET_MIME, sheetId } from "./google-sheets-import";

export const GOOGLE_PICKER_FRAME_PATH = "/connections/google-sheets/picker";
const CHANNEL = "vaettir-google-picker-v1";
export type PickerSelection = { action: "cancel" | "error" | "picked"; docs?: { id: string; mimeType: string }[] };

export function openGooglePickerFrame(input: { token: string; apiKey: string; appId: string; expires: number }, callback: (result: PickerSelection) => void) {
  const origin = window.location.origin;
  const frame = document.createElement("iframe");
  frame.title = "Choose a Google spreadsheet";
  frame.src = GOOGLE_PICKER_FRAME_PATH;
  frame.referrerPolicy = "no-referrer";
  frame.style.cssText = "position:fixed;inset:0;width:100%;height:100%;border:0;z-index:10000;background:white";
  let token = input.token;
  const { apiKey, appId, expires } = input;
  let initialized = false, disposed = false;
  const previousFocus = document.activeElement;
  const loading = setTimeout(() => finish({ action: "error" }), 30000);
  function dispose() {
    if (disposed) return;
    disposed = true; token = "";
    clearTimeout(loading);
    window.removeEventListener("message", receive);
    frame.remove();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
  }
  function finish(result: PickerSelection) { if (!disposed) { dispose(); callback(result); } }
  function receive(event: MessageEvent) {
    if (disposed || event.origin !== origin || event.source !== frame.contentWindow) return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL) return;
    if (data.action === "ready" && !initialized) {
      if (expires <= Date.now()) { finish({ action: "error" }); return; }
      initialized = true;
      frame.contentWindow!.postMessage({ channel: CHANNEL, action: "initialize", token, apiKey, appId, expires }, origin);
      token = "";
    } else if (initialized && data.action === "opened") clearTimeout(loading);
    else if (initialized && (data.action === "cancel" || data.action === "error")) finish({ action: data.action });
    else if (initialized && data.action === "picked") {
      try {
        if (!Array.isArray(data.docs) || data.docs.length !== 1 || data.docs[0]?.mimeType !== GOOGLE_SHEET_MIME) throw new Error("Invalid selection");
        finish({ action: "picked", docs: [{ id: sheetId(data.docs[0].id), mimeType: GOOGLE_SHEET_MIME }] });
      } catch { finish({ action: "error" }); }
    }
  }
  window.addEventListener("message", receive);
  frame.onerror = () => finish({ action: "error" });
  document.body.append(frame);
  frame.focus();
  return { dispose };
}
