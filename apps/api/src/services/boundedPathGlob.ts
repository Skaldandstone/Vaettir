// Repository-policy globs are data, not regular expressions. Parse and match
// iteratively with explicit limits; unsupported syntax never becomes a match.
export const PATH_GLOB_LIMITS = {
  patternLength: 256,
  pathLength: 1024,
  segmentLength: 256,
  segments: 64,
  alternatives: 32,
  braceDepth: 4,
  tokens: 512,
  operations: 250_000,
  rules: 50,
} as const;

type Token = { kind: 'literal'; value: string } | { kind: 'star' } | { kind: 'any' }
  | { kind: 'class'; negate: boolean; ranges: [number, number][] };
type Segment = { globstar: true } | { globstar: false; tokens: Token[]; dot: boolean };
export interface CompiledPathGlob { alternatives: Segment[][]; negate: boolean; comment: boolean }
export interface GlobBudget { remaining: number }

function expandBraces(pattern: string): string[] | undefined {
  const pending = [pattern];
  const expanded: string[] = [];
  while (pending.length) {
    const current = pending.pop()!;
    let open = -1; let close = -1; let depth = 0; let inClass = false;
    for (let index = 0; index < current.length; index++) {
      const char = current[index];
      if (char === '\\') { index++; continue; }
      if (char === '[') inClass = true;
      if (char === ']') inClass = false;
      if (inClass) continue;
      if (char === '{') {
        if (open === -1) open = index;
        if (++depth > PATH_GLOB_LIMITS.braceDepth) return undefined;
      } else if (char === '}') {
        if (depth === 0) return undefined;
        if (--depth === 0) { close = index; break; }
      }
    }
    if (open === -1) { expanded.push(current); continue; }
    if (close === -1) return undefined;
    const body = current.slice(open + 1, close);
    const choices: string[] = []; let start = 0; depth = 0; inClass = false;
    for (let index = 0; index < body.length; index++) {
      const char = body[index];
      if (char === '\\') { index++; continue; }
      if (char === '[') inClass = true;
      if (char === ']') inClass = false;
      if (inClass) continue;
      if (char === '{') depth++;
      if (char === '}') depth--;
      if (char === ',' && depth === 0) { choices.push(body.slice(start, index)); start = index + 1; }
    }
    if (choices.length) choices.push(body.slice(start));
    else {
      const range = /^(-?\d+|[a-zA-Z])\.\.(-?\d+|[a-zA-Z])(?:\.\.(-?\d+))?$/.exec(body);
      if (!range) {
        // Minimatch treats non-list/non-range balanced braces as literal text.
        if (body.includes('{') || body.includes('}')) return undefined;
        pending.push(current.slice(0, open) + '\\{' + body + '\\}' + current.slice(close + 1));
        continue;
      }
      const firstText = range[1]!; const lastText = range[2]!;
      const numeric = /^-?\d+$/.test(firstText) && /^-?\d+$/.test(lastText);
      if (!numeric && (!/^[a-zA-Z]$/.test(firstText) || !/^[a-zA-Z]$/.test(lastText))) return undefined;
      const first = numeric ? Number(firstText) : firstText.charCodeAt(0);
      const last = numeric ? Number(lastText) : lastText.charCodeAt(0);
      const distance = Math.abs(Number(range[3] ?? 1));
      if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || !Number.isSafeInteger(distance) || distance === 0) return undefined;
      const count = Math.floor(Math.abs(last - first) / distance) + 1;
      if (count > PATH_GLOB_LIMITS.alternatives) return undefined;
      const padded = numeric && [firstText, lastText].some(value => /^-?0\d/.test(value));
      const width = Math.max(firstText.replace('-', '').length, lastText.replace('-', '').length);
      for (let index = 0; index < count; index++) {
        const value = first + index * distance * (first <= last ? 1 : -1);
        choices.push(numeric ? (padded ? `${value < 0 ? '-' : ''}${String(Math.abs(value)).padStart(width, '0')}` : String(value)) : String.fromCharCode(value));
      }
    }
    if (expanded.length + pending.length + choices.length > PATH_GLOB_LIMITS.alternatives) return undefined;
    for (const choice of choices) {
      const value = current.slice(0, open) + choice + current.slice(close + 1);
      if (value.length > PATH_GLOB_LIMITS.patternLength) return undefined;
      pending.push(value);
    }
  }
  return expanded;
}

export function compilePathGlob(pattern: string): CompiledPathGlob | undefined {
  if (typeof pattern !== 'string' || !pattern || pattern.length > PATH_GLOB_LIMITS.patternLength || pattern.includes('\0')) return undefined;
  if (pattern.startsWith('#')) return { alternatives: [], negate: false, comment: true };
  let negate = false;
  while (pattern.startsWith('!') && !pattern.startsWith('!(')) { negate = !negate; pattern = pattern.slice(1); }
  // Extglobs/POSIX classes require a different parser. Reject them explicitly
  // instead of interpreting their special characters as a lower-risk match.
  if (!pattern || /[?*+@!]\(/.test(pattern) || pattern.includes('[[:')) return undefined;
  const expanded = expandBraces(pattern);
  if (!expanded) return undefined;
  const alternatives: Segment[][] = []; let totalTokens = 0;
  for (const alternative of expanded) {
    const segments = alternative.split('/').filter((part, index, all) => part !== '' || index === 0 || index === all.length - 1);
    if (segments.length > PATH_GLOB_LIMITS.segments) return undefined;
    const compiled: Segment[] = [];
    for (const segment of segments) {
      if (segment.length > PATH_GLOB_LIMITS.segmentLength) return undefined;
      if (segment === '**') { compiled.push({ globstar: true }); totalTokens++; continue; }
      const tokens: Token[] = [];
      for (let index = 0; index < segment.length; index++) {
        const char = segment[index]!;
        if (char === '\\') {
          if (++index >= segment.length) return undefined;
          tokens.push({ kind: 'literal', value: segment[index]! });
        } else if (char === '*') {
          if (tokens.at(-1)?.kind !== 'star') tokens.push({ kind: 'star' });
        } else if (char === '?') tokens.push({ kind: 'any' });
        else if (char === '[') {
          const ranges: [number, number][] = []; let negateClass = false;
          index++;
          if (segment[index] === '!' || segment[index] === '^') { negateClass = true; index++; }
          while (index < segment.length && segment[index] !== ']') {
            if (segment[index] === '\\') index++;
            if (index >= segment.length) return undefined;
            const first = segment.charCodeAt(index++); let last = first;
            if (segment[index] === '-' && segment[index + 1] && segment[index + 1] !== ']') {
              index++;
              if (segment[index] === '\\') index++;
              if (index >= segment.length) return undefined;
              last = segment.charCodeAt(index++);
              if (last < first) return undefined;
            }
            ranges.push([first, last]);
          }
          if (segment[index] !== ']' || ranges.length === 0) return undefined;
          tokens.push({ kind: 'class', negate: negateClass, ranges });
        } else tokens.push({ kind: 'literal', value: char });
      }
      totalTokens += tokens.length;
      compiled.push({ globstar: false, tokens, dot: tokens[0]?.kind === 'literal' && tokens[0].value === '.' });
    }
    if (totalTokens > PATH_GLOB_LIMITS.tokens) return undefined;
    alternatives.push(compiled);
  }
  return { alternatives, negate, comment: false };
}

function matchSegment(path: string, segment: Exclude<Segment, { globstar: true }>, budget: GlobBudget): boolean | undefined {
  if (path.startsWith('.') && !segment.dot) return false;
  let previous = new Uint8Array(path.length + 1); previous[0] = 1;
  for (const token of segment.tokens) {
    const current = new Uint8Array(path.length + 1);
    if (token.kind === 'star') current[0] = previous[0] ?? 0;
    for (let index = 1; index <= path.length; index++) {
      if (--budget.remaining < 0) return undefined;
      if (token.kind === 'star') current[index] = previous[index] || current[index - 1] || 0;
      else {
        const code = path.charCodeAt(index - 1);
        const matches = token.kind === 'any' || (token.kind === 'literal' ? token.value === path[index - 1]
          : token.ranges.some(([first, last]) => code >= first && code <= last) !== token.negate);
        current[index] = previous[index - 1] && matches ? 1 : 0;
      }
    }
    previous = current;
  }
  return previous[path.length] === 1;
}

export function matchCompiledPathGlob(path: string, glob: CompiledPathGlob, budget: GlobBudget): boolean | undefined {
  if (!path || path.startsWith('/') || path.length > PATH_GLOB_LIMITS.pathLength || path.includes('\0') || path.includes('\\')) return undefined;
  const parts = path.split('/').filter((part, index, all) => part !== '' || index === 0 || index === all.length - 1);
  if (parts.length > PATH_GLOB_LIMITS.segments || parts.some(part => part.length > PATH_GLOB_LIMITS.segmentLength || part === '.' || part === '..')) return undefined;
  if (glob.comment) return false;
  for (const segments of glob.alternatives) {
    let previous = new Uint8Array(parts.length + 1); previous[0] = 1;
    for (const [segmentIndex, segment] of segments.entries()) {
      const current = new Uint8Array(parts.length + 1);
      if (segment.globstar) current[0] = previous[0] ?? 0;
      for (let index = 1; index <= parts.length; index++) {
        if (--budget.remaining < 0) return undefined;
        if (segment.globstar) {
          // A final '/**' requires the slash to be present, even when the
          // directory suffix is empty (src/ matches, src does not).
          const zero = previous[index] && !(segmentIndex === segments.length - 1 && segments.length > 1 && index === parts.length);
          current[index] = zero || (!parts[index - 1]!.startsWith('.') && current[index - 1]) ? 1 : 0;
        }
        else if (previous[index - 1]) {
          const matches = matchSegment(parts[index - 1]!, segment, budget);
          if (matches === undefined) return undefined;
          current[index] = matches ? 1 : 0;
        }
      }
      previous = current;
    }
    if (previous[parts.length]) return !glob.negate;
  }
  return glob.negate;
}
