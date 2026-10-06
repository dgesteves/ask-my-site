/**
 * Glob matching for `--ignore`, in place of `path.matchesGlob`, which is experimental (and warns)
 * on Node 22. Supports `*`, `**`, `?`, `[...]` (`[!...]` or `[^...]` to negate) and `{a,b}`.
 * Matching is case-sensitive on every platform, so a pattern means the same in CI as on a laptop.
 */

const cache = new Map<string, RegExp[]>();

/** True if the `/`-separated relative `path` matches `pattern`. */
export function matchesGlob(path: string, pattern: string): boolean {
  let compiled = cache.get(pattern);
  if (!compiled) {
    // As in `path.matchesGlob`, a backslash separates path segments; it never escapes.
    compiled = expandBraces(pattern.replace(/\\/g, '/')).map(toRegExp);
    cache.set(pattern, compiled);
  }
  return compiled.some((regex) => regex.test(path));
}

/** `a{b,c{d,e}}` → `ab`, `acd`, `ace`. Braces without a top-level comma stay literal. */
function expandBraces(pattern: string): string[] {
  let depth = 0;
  let open = -1;
  const commas: number[] = [];
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '{') {
      if (depth === 0) {
        open = i;
        commas.length = 0;
      }
      depth += 1;
    } else if (char === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && commas.length > 0) {
        const before = pattern.slice(0, open);
        const after = pattern.slice(i + 1);
        const bounds = [open, ...commas, i];
        return bounds
          .slice(1)
          .flatMap((end, k) =>
            expandBraces(before + pattern.slice((bounds[k] ?? 0) + 1, end) + after),
          );
      }
    } else if (char === ',' && depth === 1) {
      commas.push(i);
    }
  }
  return [pattern];
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

function toRegExp(pattern: string): RegExp {
  const segments = pattern.split('/');
  let source = '';
  segments.forEach((segment, i) => {
    const last = i === segments.length - 1;
    if (segment === '**') {
      // Any number of whole segments, including none.
      source += last ? '.*' : '(?:[^/]*/)*';
      return;
    }
    source += segmentSource(segment) + (last ? '' : '/');
  });
  return new RegExp(`^${source}$`);
}

function segmentSource(segment: string): string {
  let source = '';
  for (let i = 0; i < segment.length; i += 1) {
    const char = segment[i] ?? '';
    if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else if (char === '[') {
      const negated = segment[i + 1] === '!' || segment[i + 1] === '^';
      const start = i + (negated ? 2 : 1);
      // A `]` first in a class is part of it, as in shells; with no closing `]`, `[` is literal.
      const end = segment.indexOf(']', start + 1);
      if (end === -1) {
        source += '\\[';
        continue;
      }
      const body = segment.slice(start, end).replace(/[\\\]^]/g, '\\$&');
      source += `[${negated ? '^/' : ''}${body}]`;
      i = end;
    } else {
      source += escape(char);
    }
  }
  return source;
}
