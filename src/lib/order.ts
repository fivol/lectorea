import type { BuiltCourse } from '@shared/schema';

/**
 * Where the borrowed cards stand inside their columns.
 *
 * `row` is decided once, at build time, over the whole catalogue, and the first
 * key it sorts by is the domain band — which is what makes a domain filter light
 * a contiguous stripe rather than a spray. The screen it is read on, though, is
 * almost always a *filtered* one with a chain drawn across it, and there a card
 * borrowed from another field carries its foreign band order with it: it lands
 * after every card of the field on show, however far that is from the course
 * that needed it. Over all 206 courses, each selected under its own field's
 * filter, 79 of the 87 line crossings came from exactly that — only 8 were
 * between a field's own cards, which is the build's barycentre doing its job.
 *
 * So the field's own cards keep the order the build gave them, always, and only
 * the guests are placed here. They are the cards that come and go with the
 * selection anyway; moving them costs no stability that was not already spent,
 * while reordering everything on every click — which gets crossings to 6 — would
 * mean the columns reshuffle under every question, and then they are not a map.
 *
 * Barycentre first, then adjacent swaps: 87 crossings become 15. The swaps are
 * not optional garnish — barycentre alone stops at 37, because it settles into
 * arrangements no single card can improve on by itself.
 */

export type Column = { level: number; courses: BuiltCourse[] };
export type Edge = { from: string; to: string };

/** Sweeps of the barycentre pass; it stops paying after about four. */
const SWEEPS = 4;
/** Rounds of adjacent swaps; it converges well before this in practice. */
const ROUNDS = 6;

export function placeGuests(columns: Column[], guests: Set<string>, edges: Edge[]): Column[] {
  if (!guests.size || edges.length < 2) return columns;

  const courseById = new Map<string, BuiltCourse>();
  const columnOf = new Map<string, number>();
  const order = columns.map((column, index) => {
    for (const course of column.courses) {
      courseById.set(course.id, course);
      columnOf.set(course.id, index);
    }
    return column.courses.map((course) => course.id);
  });

  // An edge with an end off the canvas cannot be crossed by anything, and its
  // missing end has no row to take a barycentre from.
  const drawn = edges.filter((edge) => columnOf.has(edge.from) && columnOf.has(edge.to));
  if (drawn.length < 2) return columns;

  const before = new Map<string, string[]>();
  const after = new Map<string, string[]>();
  for (const { from, to } of drawn) {
    before.set(to, [...(before.get(to) ?? []), from]);
    after.set(from, [...(after.get(from) ?? []), to]);
  }

  const row = new Map<string, number>();
  const settle = (): void => {
    for (const column of order) column.forEach((id, index) => row.set(id, index));
  };
  settle();

  /**
   * One column, re-sorted. A native's key is its position among the natives, so
   * their order survives untouched however the guests are shuffled around them;
   * a guest's key is the average row of what it connects to on the side being
   * swept, which drops it in between the natives it belongs with.
   */
  const slide = (column: string[], side: Map<string, string[]>): void => {
    const key = new Map<string, number>();
    let native = 0;
    for (const id of column) if (!guests.has(id)) key.set(id, native++);
    for (const id of column) {
      if (!guests.has(id)) continue;
      const rows = (side.get(id) ?? [])
        .map((other) => row.get(other))
        .filter((value): value is number => value !== undefined);
      const mean = rows.length ? rows.reduce((sum, value) => sum + value, 0) / rows.length : NaN;
      // Nothing of its chain is on the canvas — a card from the trail rather
      // than from the chain. It keeps the place it already had.
      key.set(id, Number.isNaN(mean) ? (row.get(id) ?? 0) : mean);
    }
    column.sort((a, b) => (key.get(a) ?? 0) - (key.get(b) ?? 0) || a.localeCompare(b));
    // Rows are settled per column rather than per sweep: a pass that reads
    // positions from before the pass started is reading a picture that no
    // longer exists, and it converges to a worse answer for the trouble.
    column.forEach((id, index) => row.set(id, index));
  };

  for (let sweep = 0; sweep < SWEEPS; sweep++) {
    for (const column of order) slide(column, before);
    for (const column of [...order].reverse()) slide(column, after);
  }

  const crossings = (): number => {
    let total = 0;
    for (let i = 0; i < drawn.length; i++) {
      for (let j = i + 1; j < drawn.length; j++) {
        if (cross(drawn[i], drawn[j], columnOf, row)) total++;
      }
    }
    return total;
  };

  let best = crossings();
  for (let round = 0; round < ROUNDS && best > 0; round++) {
    let improved = false;
    for (const column of order) {
      for (let i = 0; i + 1 < column.length; i++) {
        // Natives never trade places with each other; a swap has to involve a
        // guest, which is the only card this function is allowed to move.
        if (!guests.has(column[i]) && !guests.has(column[i + 1])) continue;
        swap(column, i, row);
        const now = crossings();
        if (now < best) {
          best = now;
          improved = true;
        } else {
          swap(column, i, row);
        }
      }
    }
    if (!improved) break;
  }

  return columns.map((column, index) => ({
    level: column.level,
    courses: order[index]
      .map((id) => courseById.get(id))
      .filter((course): course is BuiltCourse => Boolean(course)),
  }));
}

function swap(column: string[], i: number, row: Map<string, number>): void {
  [column[i], column[i + 1]] = [column[i + 1], column[i]];
  row.set(column[i], i);
  row.set(column[i + 1], i + 1);
}

/**
 * Whether two lines cross, in card coordinates — column across, row down.
 *
 * Edges sharing an end never count: two prerequisites arriving at one course
 * meet there, they do not cross, and calling that a crossing would have the
 * ordering fight the one shape a chain is supposed to have.
 */
function cross(
  a: Edge,
  b: Edge,
  columnOf: Map<string, number>,
  row: Map<string, number>
): boolean {
  if (a.from === b.from || a.from === b.to || a.to === b.from || a.to === b.to) return false;

  const point = (id: string): [number, number] => [columnOf.get(id) ?? 0, row.get(id) ?? 0];
  const [ax, ay] = point(a.from);
  const [bx, by] = point(a.to);
  const [cx, cy] = point(b.from);
  const [dx, dy] = point(b.to);

  const side = (
    px: number,
    py: number,
    qx: number,
    qy: number,
    rx: number,
    ry: number
  ): number => Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));

  return (
    side(ax, ay, bx, by, cx, cy) * side(ax, ay, bx, by, dx, dy) < 0 &&
    side(cx, cy, dx, dy, ax, ay) * side(cx, cy, dx, dy, bx, by) < 0
  );
}
