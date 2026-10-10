// The theme components' names from before ask-my-site became ondocs, which still work.

const warned = new Set<string>();

/** `docusaurus start`, as the site's bundler defines `NODE_ENV`. */
function isDevelopment(): boolean {
  try {
    return process.env.NODE_ENV === 'development';
  } catch {
    // No bundler defined it, and there is no `process` in a browser.
    return false;
  }
}

/**
 * Says once that a theme component has a new name: while the site builds (server-side rendering)
 * or in `docusaurus start`, never in a visitor's browser.
 */
export function warnRenamed(old: string, current: string): void {
  if (warned.has(old)) return;
  warned.add(old);
  if (typeof window !== 'undefined' && !isDevelopment()) return;
  console.warn(
    `[ondocs] ${old} is now ${current}. Import it from there; the old name still works for now.`,
  );
}
