// The Algiz-inspired guardian mark -- see STYLE_GUIDE.md #4. Redrawn as a
// simple 5-line glyph rather than the literal Unicode rune so it reads as
// a designed logomark. Two approved uses only: small in the nav (default
// size here), or huge/faint as hero background texture (pass size + a
// low opacity wrapper where that's needed -- don't add a third variant).
export function RuneMark({ size = 20 }: { size?: number }) {
  return (
    <svg className="rune" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <line x1="20" y1="4" x2="20" y2="36" />
      <line x1="20" y1="14" x2="34" y2="4" />
      <line x1="20" y1="14" x2="6" y2="4" />
      <line x1="20" y1="24" x2="34" y2="34" />
      <line x1="20" y1="24" x2="6" y2="34" />
    </svg>
  );
}
