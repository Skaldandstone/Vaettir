import { GOOGLE_PICKER_DOCUMENT } from "@/lib/google-picker-document";

// Protected by the existing connections middleware. No customer data/config or
// credentials enter this response. The meta policy also survives an upstream
// no-referrer header; the parent import document keeps its existing policy.
export function GET() {
  return new Response(GOOGLE_PICKER_DOCUMENT, { headers: {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "origin",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
  } });
}
