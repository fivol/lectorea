import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { hasGlyph, glyphFor } from '../src/components/DomainIcon';

/**
 * A domain without a glyph still renders — it falls back to a plain ring — so
 * nothing breaks and nobody notices. This is the only thing that would.
 */

const domains = parse(
  fs.readFileSync(path.join(__dirname, '../data/domains.yaml'), 'utf8')
) as Array<{ id: string }>;

describe('domain icons', () => {
  it('covers every domain in domains.yaml', () => {
    const missing = domains.filter((domain) => !hasGlyph(domain.id)).map((domain) => domain.id);
    expect(missing).toEqual([]);
  });

  it('has at least one path per domain', () => {
    for (const domain of domains) {
      expect(glyphFor(domain.id).length).toBeGreaterThan(0);
    }
  });

  it('draws only with commands the 24×24 grid uses', () => {
    // Catches a stray `z`-less fill or a typo that silently renders nothing.
    for (const domain of domains) {
      for (const glyph of glyphFor(domain.id)) {
        expect(glyph.d).toMatch(/^M[\s\d.-]/);
        expect(glyph.d).not.toMatch(/[^MmLlHhVvCcSsQqTtAaZz\d\s.,-]/);
      }
    }
  });
});
