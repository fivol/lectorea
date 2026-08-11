/**
 * A closed outline as a list of points, and the two questions anybody asks of
 * one: is this point inside, and how far is it from the edge.
 *
 * Both the map importer and the terrain filler need exactly this and nothing
 * else — the importer to find where a name goes, the filler to find which cells
 * a territory owns — so it is written once here rather than twice in their own
 * dialects. Everything works on a flat list of points: the curves are gone by
 * then, which is what makes the tests cheap enough to run over every hex of the
 * map.
 */

export type Point = { x: number; y: number };

/**
 * Flattens one closed outline into a polygon.
 *
 * `M`, `L`, `Q` and `Z` in absolute form, which is the whole vocabulary of
 * `public/map.svg` and of the sandbox export it comes from — the quadratics are
 * the rounded hex corners. Anything else throws rather than being skipped: a
 * silently dropped arc is a polygon with a straight line across a bay in it,
 * and every answer taken off it afterwards would be quietly wrong.
 */
export function ringOf(d: string, steps = 4): Point[] {
  const points: Point[] = [];
  const tokens = d.match(/[MLQZ]|-?\d+(?:\.\d+)?/g) ?? [];
  let cursor: Point = { x: 0, y: 0 };
  let index = 0;

  const number = (): number => {
    const value = Number(tokens[index++]);
    if (!Number.isFinite(value)) throw new Error(`malformed path data near "${tokens[index - 1]}"`);
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
        throw new Error(`unsupported path command "${command}"`);
    }
  }
  return points;
}

export function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared
    ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared))
    : 0;
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/** Ray casting: how many times a ray to the east crosses the outline. */
export function insideRing(point: Point, ring: Point[]): boolean {
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
export function signedDistance(point: Point, ring: Point[]): number {
  let nearest = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    nearest = Math.min(nearest, distanceToSegment(point, ring[i], ring[j]));
  }
  return insideRing(point, ring) ? nearest : -nearest;
}

/** The box the outline fits in. */
export function boxOf(ring: Point[]): { x: number; y: number; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of ring) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  return Number.isFinite(minX)
    ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
    : { x: 0, y: 0, width: 0, height: 0 };
}
