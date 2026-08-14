import fs from 'node:fs';
import path from 'node:path';
import { insideRing, ringOf, signedDistance, type Point } from '../../shared/polygon.js';
import type { Continent } from '../../shared/schema.js';
import { ensureDir, paths } from './config.js';
import { writeGroundPlan } from './map-ground.js';
import { SourceError } from './sources.js';

/**
 * The map file the app reads, and everything measured off an outline to write
 * one.
 *
 * Two paths lead here and they must arrive at the same file. `pnpm map:import`
 * brings in a picture drawn in the sandbox and keeps only its geometry;
 * `pnpm map:build` runs the generator headlessly and keeps all of it. What the
 * screen then reads — where a name is centred, how much room it has, which
 * continent a coast belongs to — is measured here in both cases, so the two
 * maps cannot end up describing themselves in different dialects.
 *
 * The label point is the pole of inaccessibility rather than the centroid: a
 * centroid lands outside a crescent-shaped territory and drops the name on the
 * neighbour's ground.
 */

/* ─────────────────────────────  Measurement  ───────────────────────────── */

/** Where a name goes on one territory, and how much of one fits there. */
export type Anchor = {
  x: number;
  y: number;
  /** Radius of the largest circle inside the outline, centred on the point. */
  room: number;
  /** Width of the outline along the line the name is written on. */
  span: number;
};

/**
 * The outline as a polygon.
 *
 * `ringOf` handles the absolute `M`/`L`/`Q`/`Z` both sources write — the
 * quadratics are the rounded hex corners — and refuses anything wider. A
 * refusal is a bad map rather than a bug, so it is reported as one.
 */
export function ringFrom(d: string, what: string): Point[] {
  try {
    return ringOf(d);
  } catch (error) {
    throw new SourceError(
      `${error instanceof Error ? error.message : String(error)} in ${what}`
    );
  }
}

/**
 * The point inside the outline furthest from any edge, and how far that is.
 *
 * Quadtree search (the polylabel algorithm): split the bounding box, always
 * open the cell whose optimistic best is highest, stop when no cell can beat
 * the champion by more than `precision`.
 */
function poleOfInaccessibility(ring: Point[], precision = 1): Point & { room: number } {
  const xs = ring.map((p) => p.x);
  const ys = ring.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const size = Math.min(maxX - minX, maxY - minY);
  if (size === 0) return { x: minX, y: minY, room: 0 };

  type Cell = { x: number; y: number; half: number; distance: number; bound: number };
  const cellAt = (x: number, y: number, half: number): Cell => {
    const distance = signedDistance({ x, y }, ring);
    // A cell can hold nothing better than its centre plus its own reach.
    return { x, y, half, distance, bound: distance + half * Math.SQRT2 };
  };

  let best = cellAt((minX + maxX) / 2, (minY + maxY) / 2, size / 2);
  const queue: Cell[] = [];
  const half = size / 2;
  for (let x = minX + half / 2; x < maxX; x += half) {
    for (let y = minY + half / 2; y < maxY; y += half) {
      queue.push(cellAt(x, y, half / 2));
    }
  }

  while (queue.length) {
    // Small queues over few dozen territories — a scan beats a heap here.
    let index = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i].bound > queue[index].bound) index = i;
    const cell = queue.splice(index, 1)[0];

    if (cell.distance > best.distance) best = cell;
    if (cell.bound - best.distance <= precision) continue;

    const quarter = cell.half / 2;
    queue.push(cellAt(cell.x - quarter, cell.y - quarter, quarter));
    queue.push(cellAt(cell.x + quarter, cell.y - quarter, quarter));
    queue.push(cellAt(cell.x - quarter, cell.y + quarter, quarter));
    queue.push(cellAt(cell.x + quarter, cell.y + quarter, quarter));
  }

  return { x: best.x, y: best.y, room: best.distance };
}

/**
 * How wide a single line of text can be at the label point.
 *
 * The inscribed circle alone is too pessimistic for a territory that is much
 * wider than it is tall — it would drop a name that in fact has plenty of
 * shoreline to run along. This measures the actual gap: the run of the
 * horizontal line through the label point that stays inside the outline.
 */
function spanAt(point: Point, ring: Point[]): number {
  const crossings: number[] = [];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > point.y === b.y > point.y) continue;
    crossings.push(a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x));
  }
  crossings.sort((left, right) => left - right);

  // The label point is inside, so it falls in one of the inside intervals —
  // the pairs, counting from the left.
  for (let i = 0; i + 1 < crossings.length; i += 2) {
    if (point.x >= crossings[i] && point.x <= crossings[i + 1]) {
      return crossings[i + 1] - crossings[i];
    }
  }
  return 0;
}

/** Where the name of one territory goes, measured off its own outline. */
export function anchorOf(ring: Point[]): Anchor {
  const pole = poleOfInaccessibility(ring);
  return { x: pole.x, y: pole.y, room: pole.room, span: spanAt(pole, ring) };
}

/* ────────────────────────────  Landmass identity  ──────────────────────── */

export type LandmassKind = 'continent' | 'island';

/**
 * Which continent each coastline belongs to, and which of them is that
 * continent's mainland.
 *
 * For a map that does not already say. A landmass belongs to whoever holds most
 * of the ground inside it, and the largest of a continent's landmasses is the
 * continent itself — which is what lets the screen write a continent's name over
 * its mainland instead of over the water between its outlying islands.
 */
export function describeLandmasses<T extends { continent: Continent; anchor: Anchor }>(
  coasts: string[],
  territories: T[]
): Array<{ d: string; continent: Continent; kind: LandmassKind }> {
  const described = coasts.map((d) => {
    const ring = ringFrom(d, 'a coastline');
    const held = territories.filter((territory) => insideRing(territory.anchor, ring));
    const tally = new Map<Continent, number>();
    for (const territory of held) {
      tally.set(territory.continent, (tally.get(territory.continent) ?? 0) + 1);
    }
    const [continent] = [...tally].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (!continent) {
      throw new SourceError(`a landmass holds no territory: ${d.slice(0, 40)}…`);
    }
    return { d, continent, held: held.length };
  });

  const largest = new Map<Continent, number>();
  for (const mass of described) {
    largest.set(mass.continent, Math.max(largest.get(mass.continent) ?? 0, mass.held));
  }

  return described.map(({ d, continent, held }) => ({
    d,
    continent,
    kind: held === largest.get(continent) ? 'continent' : 'island',
  }));
}

/* ───────────────────────────────  Writing  ─────────────────────────────── */

export type FileTerritory = {
  shapeId: string;
  domainId: string;
  continent: Continent;
  d: string;
  anchor: Anchor;
};

export type FileLandmass = { continent: Continent; kind: LandmassKind; d: string };

export type MapFile = {
  viewBox: string;
  landmasses: FileLandmass[];
  territories: FileTerritory[];
  /** How the file came about, for whoever opens it. */
  provenance: string;
};

/** The map file as text: geometry, and the anchors the screen writes names on. */
export function mapFileSvg({ viewBox, landmasses, territories, provenance }: MapFile): string {
  const land = landmasses
    .map(
      (mass, index) =>
        `<path id="land-${index + 1}" class="coastline" ` +
        `data-continent="${mass.continent}" data-kind="${mass.kind}" d="${mass.d}"/>`
    )
    .join('\n  ');

  const ground = territories
    .map(
      ({ shapeId, domainId, continent, d, anchor }) =>
        `<path id="${shapeId}" class="domain-shape" ` +
        `data-domain="${domainId}" data-continent="${continent}" ` +
        `data-cx="${anchor.x.toFixed(1)}" data-cy="${anchor.y.toFixed(1)}" ` +
        `data-room="${anchor.room.toFixed(1)}" data-span="${anchor.span.toFixed(1)}" d="${d}"/>`
    )
    .join('\n  ');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">
  <!-- ${provenance}
       Colours, labels and the sea belong to the app and are not in here. The
       territory ids match domain.shapeId; the coastlines are the landmasses
       those territories tile, one path each. -->
  ${land}
  ${ground}
</svg>
`;
}

/**
 * Writes one of the app's map files and reports what went into it — and, in the
 * same breath, the scenery's plan for it.
 *
 * The two are written together because they can only ever be wrong apart: a
 * redrawn map with last week's plan is the one failure the whole design of
 * `shared/tiles/plan.ts` is built to make loud, and the cheapest way to make it
 * loud is for it never to happen by hand. `pnpm map:ground` exists for the other
 * direction — a biome recipe edited without the map being redrawn.
 */
export function writeMapFile(target: string, file: MapFile): void {
  const svg = mapFileSvg(file);
  ensureDir(paths.publicDir);
  fs.writeFileSync(target, svg, 'utf8');
  const islands = file.landmasses.filter((mass) => mass.kind === 'island').length;
  console.log(
    `✓ ${path.relative(process.cwd(), target)} · ${file.territories.length} territories · ` +
      `${file.landmasses.length} landmasses (${islands} islands) · ` +
      `${(Buffer.byteLength(svg) / 1024).toFixed(1)} KB`
  );
  console.log(`  ${writeGroundPlan(target)}`);
}
