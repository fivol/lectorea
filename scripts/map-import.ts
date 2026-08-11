import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, paths } from './lib/config.js';
import { loadSources, reportSourceError, SourceError } from './lib/sources.js';
import type { Continent, Domain } from '../shared/schema.js';

/**
 * Imports an SVG exported from the map sandbox (`pnpm map:sandbox`) into
 * `public/map.svg`.
 *
 * The export is a picture: a sea, drop shadows, dependency links, labels, and
 * territories carrying the colours the sandbox happened to be showing. The app
 * needs none of that — it paints the territories itself from `domains.yaml` and
 * writes its own labels. What it cannot recover is the geometry, so this keeps
 * the outlines and the coastline and throws the rest away.
 *
 * It also writes what the export does not carry: the continent each territory
 * belongs to, the point a label can be centred on, and how much room there is
 * around it. That point is the pole of inaccessibility rather than the centroid
 * — these territories are blobs grown around a seed, and a centroid lands
 * outside a crescent-shaped one — and the room is its distance to the border,
 * which is what the screen sizes and drops labels by.
 *
 *   pnpm map:import '~/Downloads/map (1).svg'
 */

const USAGE = "usage: pnpm map:import <sandbox-export.svg>";

type Point = { x: number; y: number };

/* ──────────────────────────────  Reading  ──────────────────────────────── */

const PATH_RE = /<path\b([^>]*?)\/>/g;
const ATTR_RE = /([\w-]+)="([^"]*)"/g;

type RawPath = { attributes: Record<string, string>; d: string };

function readPaths(svg: string): RawPath[] {
  const result: RawPath[] = [];
  for (const match of svg.matchAll(PATH_RE)) {
    const attributes: Record<string, string> = {};
    for (const attribute of match[1].matchAll(ATTR_RE)) {
      attributes[attribute[1]] = attribute[2];
    }
    if (attributes.d) result.push({ attributes, d: attributes.d });
  }
  return result;
}

/**
 * The coastline, as the sandbox draws it: the only unfilled paths that are not
 * dependency links. A link is a straight dashed segment between two anchors.
 */
const isCoast = (path: RawPath): boolean =>
  !path.attributes.id &&
  path.attributes.fill === 'none' &&
  !('stroke-dasharray' in path.attributes);

/* ─────────────────────────────  Geometry  ──────────────────────────────── */

/**
 * Flattens one closed outline into a polygon.
 *
 * The sandbox writes absolute `M`/`L`/`Q`/`Z` only — the quadratics are the
 * rounded hex corners — so this handles that subset and nothing else, and says
 * so loudly if a future export brings anything wider.
 */
function flatten(d: string, steps = 4): Point[] {
  const points: Point[] = [];
  const tokens = d.match(/[MLQZ]|-?\d+(?:\.\d+)?/g) ?? [];
  let cursor: Point = { x: 0, y: 0 };
  let index = 0;

  const number = (): number => {
    const value = Number(tokens[index++]);
    if (!Number.isFinite(value)) throw new SourceError(`malformed path data near "${tokens[index - 1]}"`);
    return value;
  };

  while (index < tokens.length) {
    const command = tokens[index++];
    switch (command) {
      case 'M':
      case 'L': {
        cursor = { x: number(), y: number() };
        points.push(cursor);
        break;
      }
      case 'Q': {
        const cx = number();
        const cy = number();
        const to = { x: number(), y: number() };
        for (let step = 1; step <= steps; step++) {
          const t = step / steps;
          const u = 1 - t;
          points.push({
            x: u * u * cursor.x + 2 * u * t * cx + t * t * to.x,
            y: u * u * cursor.y + 2 * u * t * cy + t * t * to.y,
          });
        }
        cursor = to;
        break;
      }
      case 'Z':
        break;
      default:
        throw new SourceError(`unsupported path command "${command}" in the export`);
    }
  }
  return points;
}

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared
    ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared))
    : 0;
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function isInside(point: Point, ring: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Distance to the outline, negative outside the polygon. */
function signedDistance(point: Point, ring: Point[]): number {
  let nearest = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    nearest = Math.min(nearest, distanceToSegment(point, ring[i], ring[j]));
  }
  return isInside(point, ring) ? nearest : -nearest;
}

/**
 * The point inside the outline furthest from any edge, and how far that is —
 * where a label goes, and how much of one fits there. Quadtree search (the
 * polylabel algorithm): split the bounding box, always open the cell whose
 * optimistic best is highest, stop when no cell can beat the champion by more
 * than `precision`.
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

/* ─────────────────────────────  Landmasses  ────────────────────────────── */

type Landmass = { d: string; continent: Continent; kind: 'continent' | 'island' };

/**
 * Which continent each coastline belongs to, and which of them is that
 * continent's mainland.
 *
 * The export does not say — it draws every coast the same way — so it is read
 * back off the territories: a landmass belongs to whoever holds most of the
 * ground inside it, and the largest of a continent's landmasses is the
 * continent itself. That is what lets the screen write a continent's name over
 * its mainland instead of over the water between its outlying islands.
 */
function describeLandmasses(
  coasts: RawPath[],
  territories: Array<{ domain: Domain; label: Point }>
): Landmass[] {
  const described = coasts.map((coast) => {
    const ring = flatten(coast.d);
    const held = territories.filter((territory) => isInside(territory.label, ring));
    const tally = new Map<Continent, number>();
    for (const territory of held) {
      tally.set(territory.domain.continent, (tally.get(territory.domain.continent) ?? 0) + 1);
    }
    const [continent] = [...tally].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (!continent) {
      throw new SourceError(`a landmass in the export holds no territory: ${coast.d.slice(0, 40)}…`);
    }
    return { d: coast.d, continent, held: held.length };
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

/* ───────────────────────────────  Import  ──────────────────────────────── */

function main(): void {
  const source = process.argv[2];
  if (!source) {
    console.error(USAGE);
    process.exit(1);
  }
  const file = source.replace(/^~(?=\/)/, process.env.HOME ?? '~');
  if (!fs.existsSync(file)) {
    console.error(`${file}: no such file\n${USAGE}`);
    process.exit(1);
  }

  const svg = fs.readFileSync(file, 'utf8');
  const viewBox = /viewBox="([^"]+)"/.exec(svg)?.[1];
  if (!viewBox) throw new SourceError(`${path.basename(file)} has no viewBox`);

  const all = readPaths(svg);
  const coasts = all.filter(isCoast);
  const shapes = new Map(
    all
      .filter((p) => p.attributes.id?.startsWith('shape-'))
      .map((p) => [p.attributes.id, p] as const)
  );
  if (!coasts.length) throw new SourceError(`${path.basename(file)} carries no coastline`);

  // The map is only ever as good as its agreement with domains.yaml: a
  // territory the app cannot name is a hole, a domain with no territory is a
  // field that silently vanishes off the map.
  const { domains } = loadSources();
  const missing = domains.filter((domain) => !shapes.has(domain.shapeId));
  const extra = [...shapes.keys()].filter(
    (id) => !domains.some((domain) => domain.shapeId === id)
  );
  if (missing.length || extra.length) {
    throw new SourceError('the export and data/domains.yaml disagree', [
      ...missing.map((domain) => `missing territory ${domain.shapeId} (domain ${domain.id})`),
      ...extra.map((id) => `${id} has no domain in domains.yaml`),
    ]);
  }

  const territories = domains.map((domain) => {
    const d = shapes.get(domain.shapeId)!.d;
    const ring = flatten(d);
    const pole = poleOfInaccessibility(ring);
    return { domain, d, label: { ...pole, span: spanAt(pole, ring) } };
  });

  const landmasses = describeLandmasses(coasts, territories);

  const drawnLand = landmasses
    .map(
      (mass, index) =>
        `<path id="land-${index + 1}" class="coastline" ` +
        `data-continent="${mass.continent}" data-kind="${mass.kind}" d="${mass.d}"/>`
    )
    .join('\n  ');

  const drawnTerritories = territories
    .map(
      ({ domain, d, label }) =>
        `<path id="${domain.shapeId}" class="domain-shape" ` +
        `data-domain="${domain.id}" data-continent="${domain.continent}" ` +
        `data-cx="${label.x.toFixed(1)}" data-cy="${label.y.toFixed(1)}" ` +
        `data-room="${label.room.toFixed(1)}" data-span="${label.span.toFixed(1)}" d="${d}"/>`
    )
    .join('\n  ');

  const out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" preserveAspectRatio="xMidYMid meet">
  <!-- Imported from a map sandbox export by \`pnpm map:import\` — geometry only.
       Colours, labels and the sea belong to the app and are not in here. The
       territory ids match domain.shapeId; the coastlines are the landmasses
       those territories tile, one path each. -->
  ${drawnLand}
  ${drawnTerritories}
</svg>
`;

  ensureDir(paths.publicDir);
  fs.writeFileSync(paths.mapSvg, out, 'utf8');
  console.log(
    `✓ public/map.svg · ${territories.length} territories · ${coasts.length} landmasses · ` +
      `${(Buffer.byteLength(out) / 1024).toFixed(1)} KB`
  );
}

try {
  main();
} catch (error) {
  reportSourceError(error);
}
