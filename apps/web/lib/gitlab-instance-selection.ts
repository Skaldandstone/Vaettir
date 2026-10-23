/** UI routing only. Server-side origin/DNS checks remain the security boundary. */
export function gitlabInstanceOrigin(value: string): string | null {
  if (!value || value.length > 300) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash
      || url.port || !url.hostname.includes(".") || /^[\d.]+$/.test(url.hostname)
      || !/^[a-z0-9.-]+$/.test(url.hostname)
      || /(^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname)) return null;
    return url.origin;
  } catch { return null; }
}
