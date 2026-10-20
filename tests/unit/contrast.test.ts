import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Contrast regression tests on the design tokens themselves, so a token change that breaks
 * WCAG 2.2 contrast fails here before it reaches a screen. Ratios use the WCAG formula.
 * Browser tests (booking.spec.ts) check the same rules on the rendered controls.
 */
const css = readFileSync(new URL('../../src/styles/tokens.css', import.meta.url), 'utf8');

function blocks(): Record<string, Record<string, string>> {
  const pick = (re: RegExp) => {
    const body = css.match(re)?.[1];
    if (!body) throw new Error(`token block not found: ${re}`);
    return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
  };
  const light = pick(/:root\s*\{([\s\S]*?)\n\}/);
  return {
    light,
    'dark (system)': { ...light, ...pick(/prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme='light'\]\)\s*\{([\s\S]*?)\n {2}\}/) },
    'dark (chosen)': { ...light, ...pick(/:root\[data-theme='dark'\]\s*\{([\s\S]*?)\n\}/) },
  };
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// [foreground token, background token, minimum ratio, why]
const RULES: Array<[string, string, number, string]> = [
  ['control-border', 'card', 3, '1.4.11: input, select and switch-track edges'],
  ['control-border', 'tile', 3, '1.4.11: selected 12h/24h ring on its fill'],
  ['card', 'control-border', 3, '1.4.11: switch thumb (card colour) on the off track'],
  ['focus', 'card', 3, '2.4.11/1.4.11: focus ring'],
  ['text-emphasis', 'card', 4.5, '1.4.3: primary text'],
  ['text', 'card', 4.5, '1.4.3: body text'],
  ['text-muted', 'card', 4.5, '1.4.3: secondary text'],
  ['text-muted', 'page', 4.5, '1.4.3: footer and header text on the page'],
  ['danger', 'card', 4.5, '1.4.3: form errors'],
];

describe('design-token contrast (WCAG 2.2 AA)', () => {
  const themes = blocks();
  for (const [theme, tokens] of Object.entries(themes)) {
    for (const [fg, bg, min, why] of RULES) {
      it(`${theme}: --${fg} on --${bg} ≥ ${min}:1 (${why})`, () => {
        expect(tokens[fg], `--${fg} missing in ${theme}`).toBeDefined();
        expect(tokens[bg], `--${bg} missing in ${theme}`).toBeDefined();
        expect(contrast(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(min);
      });
    }
  }

  it('the formula matches known WCAG values', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });
});
