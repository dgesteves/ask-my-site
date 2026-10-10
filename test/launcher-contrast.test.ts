import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(join(import.meta.dirname, '../src/docusaurus/launcher.css'), 'utf8');

/** The declarations of the rule for `selector`, exactly as written. */
function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`No rule for ${selector}`);
  return css.slice(start, css.indexOf('}', start));
}

/** WCAG 2 contrast ratio of two `#rrggbb` colors. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

// Infima's values (0.2.0-alpha.45, Docusaurus 3): the launcher's background is
// --ifm-background-surface-color, white in light mode and #242526 in dark.
const INFIMA = {
  light: { surface: '#ffffff', 'emphasis-700': '#606770', 'emphasis-500': '#bec3c9' },
  dark: { surface: '#242526', 'emphasis-700': '#dadde1', 'emphasis-500': '#bec3c9' },
};

describe('the Docusaurus launcher’s shortcut hint', () => {
  it('reaches 4.5:1 in light and dark mode, with a color rather than opacity', () => {
    const light = rule('.ask-my-site-launcher > kbd');
    const dark = rule("[data-theme='dark'] .ask-my-site-launcher > kbd");
    // Opacity blends the text into the background: 3.97:1 in light mode at 0.7.
    expect(light).not.toMatch(/opacity\s*:/);
    expect(dark).not.toMatch(/opacity\s*:/);
    const variable = (declarations: string) =>
      /color: var\(--ifm-color-(emphasis-\d+)/.exec(declarations)?.[1] as 'emphasis-700';
    expect(contrast(INFIMA.light[variable(light)], INFIMA.light.surface)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(contrast(INFIMA.dark[variable(dark)], INFIMA.dark.surface)).toBeGreaterThanOrEqual(4.5);
  });
});
