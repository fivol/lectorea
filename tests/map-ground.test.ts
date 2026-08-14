import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { planFits, type GroundPlan } from '@shared/tiles';
import { parseMapSvg } from '@/lib/map';
import { groundOf } from '@/screens/Map/ground';

/**
 * The saved scenery plan has to be the plan, and it has to be current.
 *
 * Two different failures, and the first is the one that would be expensive to
 * find by eye. A plan is a cache of three passes over the map file, and the
 * whole argument for keeping one on disk is that reading it and working it out
 * cannot disagree — so that is asserted directly: every piece of markup the map
 * draws from the file must be the same string as the one it draws without it.
 * If they ever part, the map on a reader's screen and the map in the sandbox are
 * two different maps, and nothing else in the suite would say so.
 *
 * The second is staleness, which `pnpm map:ground --check` also gates in CI. It
 * is here as well because a test is what runs on a laptop before the push, and
 * a plan that is one commit behind is a fifth of a second charged to every
 * reader on a phone.
 */

const MAPS = ['public/map.svg', 'public/map-portrait.svg'];

const groundFileOf = (mapFile: string): string => mapFile.replace(/\.svg$/, '-ground.json');

const read = (file: string): string => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe.each(MAPS)('%s', (mapFile) => {
  const svg = read(mapFile);
  const saved = JSON.parse(read(groundFileOf(mapFile))) as GroundPlan;

  it('has a saved plan drawn from this file and these recipes', () => {
    // The map still draws correctly when this fails — the browser works the
    // plan out instead — so the message has to carry the cost and the cure.
    expect(
      planFits(saved, svg),
      `${groundFileOf(mapFile)} was drawn from another map or another set of ` +
        'recipes. Every reader on a phone pays a fifth of a second for it. ' +
        'Run `pnpm map:ground`.'
    ).toBe(true);
  });

  it('draws the same ground read as worked out', () => {
    const map = parseMapSvg(svg);
    // The theme reaches the sea's palette and nothing else, so one is enough to
    // prove the cells agree — and `dark` is the one whose colours are overridden.
    const fromFile = groundOf(map, 'dark', saved);
    const fromScratch = groundOf(map, 'dark', null);

    const shape = (ground: ReturnType<typeof groundOf>) => ({
      fields: ground.fields.map((field) => ({
        domainId: field.domainId,
        pieces: field.pieces.map((piece) => [piece.id, piece.box, piece.markup()]),
      })),
      ocean: ground.ocean.map((piece) => [piece.id, piece.box, piece.markup()]),
    });

    expect(shape(fromFile)).toEqual(shape(fromScratch));
  });

  it('draws something at all', () => {
    const ground = groundOf(parseMapSvg(svg), 'light', saved);
    expect(ground.fields.length).toBeGreaterThan(20);
    expect(ground.ocean.length).toBeGreaterThan(20);
    expect(ground.fields[0].pieces[0].markup().length).toBeGreaterThan(0);
  });
});
