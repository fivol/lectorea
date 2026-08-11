import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { ringOf } from '../shared/polygon';
import {
  cellsIn,
  fillCells,
  findTile,
  findTerrain,
  hexGridOf,
  terrainFor,
  DEFAULT_TERRAIN,
  TERRAINS,
  TERRAIN_BY_CONTINENT,
  TERRAIN_BY_DOMAIN,
} from '../shared/tiles';

/**
 * The correspondence between a field of knowledge and the ground it stands on
 * is the one thing about the map that a person maintains by hand, and the map
 * itself is regenerated from a sandbox export whenever it is redrawn. So this
 * is the alarm on both sides of that: the table has to know every domain, and
 * the map file has to still be a hex map the tiles can be laid on.
 */

const root = path.join(__dirname, '..');

const domains = parse(fs.readFileSync(path.join(root, 'data/domains.yaml'), 'utf8')) as Array<{
  id: string;
  continent: string;
}>;

const mapSvg = fs.readFileSync(path.join(root, 'public/map.svg'), 'utf8');

type Shape = { domainId: string; continent: string; d: string };

const shapes: Shape[] = [...mapSvg.matchAll(/<path\b([^>]*)\/>/g)]
  .map((match) => {
    const attributes: Record<string, string> = {};
    for (const attribute of match[1].matchAll(/([\w-]+)="([^"]*)"/g)) {
      attributes[attribute[1]] = attribute[2];
    }
    return attributes;
  })
  .filter((attributes) => attributes.class === 'domain-shape')
  .map((attributes) => ({
    domainId: attributes['data-domain'],
    continent: attributes['data-continent'],
    d: attributes.d,
  }));

describe('the terrain table', () => {
  it('names a terrain for every domain in domains.yaml', () => {
    const missing = domains
      .filter((domain) => !TERRAIN_BY_DOMAIN[domain.id])
      .map((domain) => domain.id);
    expect(missing).toEqual([]);
  });

  it('names no domain that has since gone', () => {
    const known = new Set(domains.map((domain) => domain.id));
    const stale = Object.keys(TERRAIN_BY_DOMAIN).filter((id) => !known.has(id));
    expect(stale).toEqual([]);
  });

  it('points only at terrains that exist', () => {
    const named = [
      ...Object.values(TERRAIN_BY_DOMAIN),
      ...Object.values(TERRAIN_BY_CONTINENT),
      DEFAULT_TERRAIN,
    ];
    expect(named.filter((id) => !findTerrain(id))).toEqual([]);
  });

  it('has a fallback for every continent the domains use', () => {
    const continents = [...new Set(domains.map((domain) => domain.continent))];
    expect(continents.filter((continent) => !TERRAIN_BY_CONTINENT[continent])).toEqual([]);
  });

  it('builds every terrain out of land pieces the collection has', () => {
    for (const terrain of TERRAINS) {
      const pieces = [
        ...terrain.scatter.map((entry) => entry.tile),
        ...(terrain.chain
          ? [terrain.chain.head, terrain.chain.body, terrain.chain.crown, terrain.chain.tail]
              .filter(Boolean)
              .map((piece) => piece!.tile)
          : []),
      ];
      expect(pieces.length, terrain.id).toBeGreaterThan(0);
      for (const id of pieces) {
        const tile = findTile(id);
        expect(tile, `${terrain.id}: ${id}`).toBeDefined();
        // Water pieces carry an opaque plate, which would paint over the one
        // thing a territory is on the map to say — its colour.
        expect(tile!.over, `${terrain.id}: ${id}`).toBe('land');
      }
      // A run is only a run if its pieces join along the east and west edges.
      if (terrain.chain) {
        const body = findTile(terrain.chain.body.tile)!;
        expect(body.seams.some((seam) => seam.edges.includes(0)), terrain.id).toBe(true);
        expect(body.seams.some((seam) => seam.edges.includes(3)), terrain.id).toBe(true);
      }
      // Scattered pieces stand on their own; a fragment dropped alone is a
      // shape nobody can read.
      for (const entry of terrain.scatter) {
        expect(findTile(entry.tile)!.kind, `${terrain.id}: ${entry.tile}`).toBe('solo');
      }
    }
  });

  it('gives an unknown domain its continent, and an unknown continent a default', () => {
    expect(terrainFor('no-such-domain', 'formal').id).toBe(TERRAIN_BY_CONTINENT.formal);
    expect(terrainFor('no-such-domain', 'atlantis').id).toBe(DEFAULT_TERRAIN);
    expect(terrainFor('no-such-domain').id).toBe(DEFAULT_TERRAIN);
  });
});

describe('the map the terrain is laid on', () => {
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
      const filled = fillCells(cells, terrainFor(shape.domainId, shape.continent), shape.domainId);
      expect(filled.length, shape.domainId).toBeGreaterThan(0);
    }
  });

  it('fills a territory the same way twice', () => {
    const shape = shapes[0];
    const cells = cellsIn(ringOf(shape.d), grid!);
    const terrain = terrainFor(shape.domainId, shape.continent);
    expect(fillCells(cells, terrain, shape.domainId)).toEqual(
      fillCells(cells, terrain, shape.domainId)
    );
  });

  it('puts every piece on a cell of the territory it belongs to', () => {
    for (const shape of shapes) {
      const cells = cellsIn(ringOf(shape.d), grid!);
      const owned = new Set(cells.map((cell) => `${cell.q},${cell.r}`));
      const filled = fillCells(cells, terrainFor(shape.domainId, shape.continent), shape.domainId);
      const strays = filled
        .filter((cell) => !owned.has(`${cell.q},${cell.r}`))
        .map((cell) => `${cell.q},${cell.r}`);
      expect(strays, shape.domainId).toEqual([]);
    }
  });
});
