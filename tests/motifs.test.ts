import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { courseArt, motifDomains, motifsFor } from '../shared/procedural';
import type { Continent } from '../shared/schema';

/**
 * Which pictures a field of knowledge may be drawn with is the one thing about
 * course art a person maintains by hand, and a field left out of the table is
 * invisible: it falls back to its continent and the cards still look fine. This
 * is the alarm on that, and on the two properties the fallback exists to keep —
 * every field has a motif, and no field has only one.
 */

const root = path.join(__dirname, '..');

const domains = parse(fs.readFileSync(path.join(root, 'data/domains.yaml'), 'utf8')) as Array<{
  id: string;
  continent: Continent;
}>;

describe('course art motifs', () => {
  it('has a line for every domain in domains.yaml', () => {
    const listed = new Set(motifDomains());
    const missing = domains.filter((domain) => !listed.has(domain.id)).map((domain) => domain.id);
    expect(missing).toEqual([]);
  });

  it('names no domain that domains.yaml has dropped', () => {
    const known = new Set(domains.map((domain) => domain.id));
    expect(motifDomains().filter((id) => !known.has(id))).toEqual([]);
  });

  it('gives every domain more than one motif, so a column is not one card forty times', () => {
    const thin = domains
      .map((domain) => ({ id: domain.id, motifs: motifsFor(domain.id, domain.continent) }))
      .filter((entry) => entry.motifs.length < 2)
      .map((entry) => entry.id);
    expect(thin).toEqual([]);
  });

  it('draws a course only with a motif its field allows', () => {
    for (const domain of domains) {
      const allowed = motifsFor(domain.id, domain.continent);
      for (let i = 0; i < 40; i++) {
        const art = courseArt(`${domain.id}-course-${i}`, { id: domain.id, color: '#4CC9F0' });
        expect(allowed).toContain(art.motif);
      }
    }
  });

  it('falls back to the continent for a field nobody has written a line for', () => {
    const motifs = motifsFor('sound-studies', 'humanities');
    expect(motifs.length).toBeGreaterThan(1);
    expect(motifs).not.toEqual(motifsFor(undefined, undefined));
  });

  it('is deterministic — the same course is the same picture', () => {
    const once = courseArt('logic-intro', { id: 'logic', color: '#4CC9F0' });
    const twice = courseArt('logic-intro', { id: 'logic', color: '#4CC9F0' });
    expect(twice).toEqual(once);
  });

  it('draws every motif as well-formed markup', () => {
    // Catches a renderer that emits an unclosed tag or a `NaN` coordinate — both
    // render as nothing at all, on one motif, and nobody would notice.
    for (const domain of domains) {
      for (let i = 0; i < 8; i++) {
        const { inner } = courseArt(`${domain.id}-${i}`, {
          id: domain.id,
          continent: domain.continent,
          color: '#4CC9F0',
        });
        expect(inner).not.toMatch(/NaN|Infinity|undefined/);
        expect(inner.match(/</g)?.length).toBe(inner.match(/>/g)?.length);
      }
    }
  });
});
