import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { insideRing, ringOf } from '../shared/polygon';
import {
  biomeFor,
  cellsIn,
  centreAt,
  colourDistance,
  colourOf,
  fillCells,
  findBiome,
  findTile,
  hexGridOf,
  oceanCells,
  BIOMES,
  BIOME_BY_CONTINENT,
  BIOME_BY_DOMAIN,
  DEFAULT_BIOME,
  OCEAN,
} from '../shared/tiles';

/**
 * The correspondence between a field of knowledge and the country it is — its
 * ground and its colour — is the one thing about the map that a person
 * maintains by hand, and the map itself is regenerated from a sandbox export
 * whenever it is redrawn. So this is the alarm on both sides of that: the table
 * has to know every domain, the palette has to stay legible on the map as it is
 * *now*, and the file has to still be a hex map the tiles can be laid on.
 */

const root = path.join(__dirname, '..');

const domains = parse(fs.readFileSync(path.join(root, 'data/domains.yaml'), 'utf8')) as Array<{
  id: string;
  continent: string;
}>;

const mapSvg = fs.readFileSync(path.join(root, 'public/map.svg'), 'utf8');

type Shape = { domainId: string; continent: string; d: string };

const paths = [...mapSvg.matchAll(/<path\b([^>]*)\/>/g)].map((match) => {
  const attributes: Record<string, string> = {};
  for (const attribute of match[1].matchAll(/([\w-]+)="([^"]*)"/g)) {
    attributes[attribute[1]] = attribute[2];
  }
  return attributes;
});

const shapes: Shape[] = paths
  .filter((attributes) => attributes.class === 'domain-shape')
  .map((attributes) => ({
    domainId: attributes['data-domain'],
    continent: attributes['data-continent'],
    d: attributes.d,
  }));

const coastlines: string[] = paths
  .filter((attributes) => attributes.class === 'coastline')
  .map((attributes) => attributes.d);

/**
 * Which territories share a border, read off the drawing rather than written
 * down anywhere: two outlines that pass through two or more of the same hex
 * corners run along each other. Corners are the exact lattice points in the
 * file — the control point of every quadratic — and snapping to a half-unit
 * absorbs the rounding the exporter did.
 */
const neighbours: Array<[string, string]> = (() => {
  const at = new Map<string, Set<string>>();
  for (const shape of shapes) {
    for (const match of shape.d.matchAll(/Q\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/g)) {
      const key = `${Math.round(Number(match[1]) * 2)},${Math.round(Number(match[2]) * 2)}`;
      if (!at.has(key)) at.set(key, new Set());
      at.get(key)!.add(shape.domainId);
    }
  }
  const shared = new Map<string, number>();
  for (const owners of at.values()) {
    const list = [...owners].sort();
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const key = `${list[i]}|${list[j]}`;
        shared.set(key, (shared.get(key) ?? 0) + 1);
      }
    }
  }
  return [...shared]
    .filter(([, corners]) => corners >= 2)
    .map(([key]) => key.split('|') as [string, string]);
})();

/**
 * How far apart two territories have to look, in OKLab.
 *
 * `NEIGHBOURS` is the one that matters: it is the answer to "are these two
 * fields the same country?" asked across a border. `ANYWHERE` is looser on
 * purpose — two fields on opposite continents may be cousins, and a palette
 * that forbids that has to spread 39 colours over the whole wheel and stops
 * looking like a map of anywhere.
 */
const NEIGHBOURS = 0.15;
const ANYWHERE = 0.045;

describe('the biome table', () => {
  it('names a biome for every domain in domains.yaml', () => {
    const missing = domains
      .filter((domain) => !BIOME_BY_DOMAIN[domain.id])
      .map((domain) => domain.id);
    expect(missing).toEqual([]);
  });

  it('names no domain that has since gone', () => {
    const known = new Set(domains.map((domain) => domain.id));
    const stale = Object.keys(BIOME_BY_DOMAIN).filter((id) => !known.has(id));
    expect(stale).toEqual([]);
  });

  it('points only at biomes and tones that exist', () => {
    const unknown: string[] = [];
    for (const [domainId, entry] of Object.entries(BIOME_BY_DOMAIN)) {
      const [id, tone] = entry.split('/');
      const biome = findBiome(id);
      if (!biome || !tone || !(tone in biome.colours)) unknown.push(`${domainId}: ${entry}`);
    }
    expect(unknown).toEqual([]);
    const fallbacks = [...Object.values(BIOME_BY_CONTINENT), DEFAULT_BIOME];
    expect(fallbacks.filter((id) => !findBiome(id))).toEqual([]);
    expect(BIOMES.filter((biome) => !(biome.fallback in biome.colours)).map((b) => b.id)).toEqual(
      []
    );
  });

  it('has a fallback for every continent the domains use', () => {
    const continents = [...new Set(domains.map((domain) => domain.continent))];
    expect(continents.filter((continent) => !BIOME_BY_CONTINENT[continent])).toEqual([]);
  });

  it('spends every tone at most once, and writes each colour once', () => {
    const spent = new Map<string, string[]>();
    for (const [domainId, entry] of Object.entries(BIOME_BY_DOMAIN)) {
      spent.set(entry, [...(spent.get(entry) ?? []), domainId]);
    }
    expect([...spent].filter(([, owners]) => owners.length > 1)).toEqual([]);

    const written = new Map<string, string[]>();
    for (const biome of BIOMES) {
      for (const [tone, colour] of Object.entries(biome.colours)) {
        const value = colour.toUpperCase();
        written.set(value, [...(written.get(value) ?? []), `${biome.id}/${tone}`]);
      }
    }
    expect([...written].filter(([, tones]) => tones.length > 1)).toEqual([]);
  });

  it('builds every biome out of land pieces the collection has', () => {
    for (const biome of BIOMES) {
      const pieces = [
        ...biome.scatter.map((entry) => entry.tile),
        ...(biome.chain
          ? [biome.chain.head, biome.chain.body, biome.chain.crown, biome.chain.tail]
              .filter(Boolean)
              .map((piece) => piece!.tile)
          : []),
      ];
      expect(pieces.length, biome.id).toBeGreaterThan(0);
      for (const id of pieces) {
        const tile = findTile(id);
        expect(tile, `${biome.id}: ${id}`).toBeDefined();
        // Water pieces carry an opaque plate, which would paint over the one
        // thing a territory is on the map to say — its colour.
        expect(tile!.over, `${biome.id}: ${id}`).toBe('land');
      }
      // A run is only a run if its pieces join along the east and west edges.
      if (biome.chain) {
        const body = findTile(biome.chain.body.tile)!;
        expect(body.seams.some((seam) => seam.edges.includes(0)), biome.id).toBe(true);
        expect(body.seams.some((seam) => seam.edges.includes(3)), biome.id).toBe(true);
      }
      // Scattered pieces stand on their own; a fragment dropped alone is a
      // shape nobody can read.
      for (const entry of biome.scatter) {
        expect(findTile(entry.tile)!.kind, `${biome.id}: ${entry.tile}`).toBe('solo');
      }
    }
  });

  it('builds the sea out of water pieces, and paints nothing over the app’s own', () => {
    for (const band of [OCEAN.near, OCEAN.open]) {
      for (const entry of band.scatter) {
        const tile = findTile(entry.tile);
        expect(tile, `${band.id}: ${entry.tile}`).toBeDefined();
        expect(tile!.over, `${band.id}: ${entry.tile}`).toBe('water');
        // A plate is an opaque cell of sea colour. The screen paints its own
        // sea, in a colour that follows the theme, and a plate over it would
        // be a patch of some other blue.
        expect(tile!.layer, `${band.id}: ${entry.tile}`).not.toBe('plate');
      }
      if (band.chain) {
        const body = findTile(band.chain.body.tile)!;
        expect(body.over, band.id).toBe('water');
        expect(body.seams.some((seam) => seam.edges.includes(0)), band.id).toBe(true);
        expect(body.seams.some((seam) => seam.edges.includes(3)), band.id).toBe(true);
      }
    }
    expect(OCEAN.shore).toBeGreaterThan(0);
  });

  it('gives an unknown domain its continent, and an unknown continent a default', () => {
    expect(biomeFor('no-such-domain', 'formal').id).toBe(BIOME_BY_CONTINENT.formal);
    expect(biomeFor('no-such-domain', 'atlantis').id).toBe(DEFAULT_BIOME);
    expect(biomeFor('no-such-domain').id).toBe(DEFAULT_BIOME);
    expect(colourOf('no-such-domain', 'formal')).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});

describe('the palette on the map as it is drawn now', () => {
  it('finds the borders it is judged on', () => {
    // No neighbours means the corner-matching stopped working, and every
    // adjacency check below would pass by finding nothing to check.
    expect(neighbours.length).toBeGreaterThan(30);
  });

  it('gives no two neighbouring territories the same look', () => {
    const alike = neighbours
      .map(([a, b]) => ({ a, b, d: colourDistance(colourOf(a), colourOf(b)) }))
      .filter((pair) => pair.d < NEIGHBOURS)
      .sort((x, y) => x.d - y.d)
      .map((pair) => `${pair.a} (${BIOME_BY_DOMAIN[pair.a]}) ↔ ${pair.b} (${
        BIOME_BY_DOMAIN[pair.b]
      }): ${pair.d.toFixed(3)}`);
    expect(alike).toEqual([]);
  });

  it('keeps every pair of fields apart, neighbours or not', () => {
    const ids = domains.map((domain) => domain.id);
    const alike: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const d = colourDistance(colourOf(ids[i]), colourOf(ids[j]));
        if (d < ANYWHERE) alike.push(`${ids[i]} ↔ ${ids[j]}: ${d.toFixed(3)}`);
      }
    }
    expect(alike).toEqual([]);
  });

  it('keeps the islands in one biome of their own', () => {
    const coasts = paths
      .filter((attributes) => attributes.class === 'coastline')
      .map((attributes) => ({ kind: attributes['data-kind'], ring: ringOf(attributes.d) }));
    const offshore = shapes.filter((shape) => {
      const ring = ringOf(shape.d);
      const centre = {
        x: ring.reduce((sum, point) => sum + point.x, 0) / ring.length,
        y: ring.reduce((sum, point) => sum + point.y, 0) / ring.length,
      };
      return coasts.find((coast) => insideRing(centre, coast.ring))?.kind === 'island';
    });
    expect(offshore.length).toBeGreaterThan(0);
    // An island is the one place on the map with no neighbour to be told apart
    // from, so it is where a biome that exists nowhere else can live.
    const ashore = new Set(
      shapes
        .filter((shape) => !offshore.includes(shape))
        .map((shape) => biomeFor(shape.domainId, shape.continent).id)
    );
    for (const shape of offshore) {
      const biome = biomeFor(shape.domainId, shape.continent).id;
      expect(ashore.has(biome), `${shape.domainId} wears ${biome}, which the mainland also wears`)
        .toBe(false);
    }
  });
});

describe('the map the ground is laid on', () => {
  const grid = hexGridOf(shapes.map((shape) => shape.d));

  it('is still a hex map, and says at what size', () => {
    // Null here means the outlines stopped fitting a hex lattice — the app
    // draws a plain coloured map instead, and this is the only warning.
    expect(grid).not.toBeNull();
    expect(grid!.r).toBeGreaterThan(4);
  });

  it('carries a territory for every domain', () => {
    const drawn = new Set(shapes.map((shape) => shape.domainId));
    expect(domains.filter((domain) => !drawn.has(domain.id)).map((d) => d.id)).toEqual([]);
  });

  it('leaves room for at least one piece of ground in every territory', () => {
    for (const shape of shapes) {
      const cells = cellsIn(ringOf(shape.d), grid!);
      expect(cells.length, shape.domainId).toBeGreaterThan(0);
      const filled = fillCells(cells, biomeFor(shape.domainId, shape.continent), shape.domainId);
      expect(filled.length, shape.domainId).toBeGreaterThan(0);
    }
  });

  it('keeps the water off the land', () => {
    const coasts = coastlines.map((d) => ringOf(d));
    const cells = oceanCells({ x: 0, y: 0, width: 1680, height: 980 }, coasts, grid!);
    expect(cells.length).toBeGreaterThan(100);
    const aground = cells.filter((cell) => {
      const centre = centreAt(cell, grid!);
      return coasts.some((ring) => insideRing(centre, ring));
    });
    expect(aground).toEqual([]);
    // The shallow band has to actually find a coast, or the shoals are the
    // same thing as the open sea.
    expect(cells.filter((cell) => cell.depth < OCEAN.shore).length).toBeGreaterThan(20);
  });

  it('fills a territory the same way twice', () => {
    const shape = shapes[0];
    const cells = cellsIn(ringOf(shape.d), grid!);
    const biome = biomeFor(shape.domainId, shape.continent);
    expect(fillCells(cells, biome, shape.domainId)).toEqual(
      fillCells(cells, biome, shape.domainId)
    );
  });

  it('puts every piece on a cell of the territory it belongs to', () => {
    for (const shape of shapes) {
      const cells = cellsIn(ringOf(shape.d), grid!);
      const owned = new Set(cells.map((cell) => `${cell.q},${cell.r}`));
      const filled = fillCells(cells, biomeFor(shape.domainId, shape.continent), shape.domainId);
      const strays = filled
        .filter((cell) => !owned.has(`${cell.q},${cell.r}`))
        .map((cell) => `${cell.q},${cell.r}`);
      expect(strays, shape.domainId).toEqual([]);
    }
  });
});
