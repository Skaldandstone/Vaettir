// Generic browser Blob-download, shared by every client-side export
// (CSV, HTML/Markdown snapshots) so there's one place that owns the
// actual download mechanics.
// Scope-sensitive callers supply their captured-view guard. Recheck at the
// browser side-effect boundaries too, not only before serializing content.
// This callback does not itself establish authorization or snapshot identity.
export function downloadFile(filename: string, content: string, mimeType: string, allowed?: () => boolean) {
  const requireCurrent = () => {
    if (allowed && !allowed()) throw new Error("Original export scope changed. Nothing was downloaded.");
  };
  requireCurrent();
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  requireCurrent();
  const url = URL.createObjectURL(blob);
  try {
    requireCurrent();
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    requireCurrent();
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
