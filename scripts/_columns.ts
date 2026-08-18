/**
 * Scratch: what a drawing option on the columns screen costs, over all of it.
 *
 * Written to settle «Все связи», which drew every edge of the selected course's
 * chain against a default that cut it back to a tree — one line out of each
 * card, to the nearest course that needs it. That switch is gone and the whole
 * chain is drawn; the tree is reconstructed here and nowhere else, because the
 * question it answers is about 197 screens rather than the one on screen, and
 * the next option on this screen will want the same replay: the field's own
 * cards, the prerequisites borrowed in behind the selection, `placeGuests` for
 * where the guests stand, then two candidate drawings counted side by side.
 *
 * The crossing count is the project's own test — `cross` in `lib/order.ts`,
 * two lines in card coordinates, edges sharing an end never counting — so the
 * number here is comparable with the 87 → 15 that ordering pass is measured by.
 * It is a count of the *graph*, not of the painted picture: under the stepped
 * drawing everything arriving at one card shares a lane, so some of these never
 * appear as ink. That is why the lane counts are printed beside it.
 *
 *   pnpm tsx scripts/_columns.ts          # the counts
 *   pnpm tsx scripts/_columns.ts worst    # and the courses that pay for it
 */
import { readFileSync } from 'node:fs';
import { placeGuests, type Column, type Edge } from '../src/lib/order.js';
import { upstreamOf } from '../shared/graph.js';
import type { BuiltCourse } from '../shared/schema.js';

const built = JSON.parse(readFileSync('public/data/courses.json', 'utf8')) as {
  courses: BuiltCourse[];
};
const courses = built.courses;
const courseById = new Map(courses.map((course) => [course.id, course]));
const dependants = new Map<string, string[]>();
for (const course of courses) {
  for (const dep of course.deps) dependants.set(dep, [...(dependants.get(dep) ?? []), course.id]);
}

type Screen = {
  id: string;
  /** Cards in the chain behind the selection, the selection included. */
  chain: number;
  tree: number;
  full: number;
  extra: number;
  crossTree: number;
  crossFull: number;
  /** Extra edges arriving where a line is already drawn — free under steps. */
  merged: number;
  /** Extra edges that skip a column, the shape that costs a row channel. */
  long: number;
  /** Cards drawn with fewer prerequisites than they have, under the tree. */
  short: number;
  /** Whether the selected card itself is one of them. */
  rootShort: boolean;
};

const screens: Screen[] = [];

for (const selected of courses) {
  // One field open, which is how this screen is reached. The whole upstream is
  // borrowed in behind the selection — see `chainAncestors`.
  const field = selected.domains[0];
  const visible = new Set(
    courses.filter((course) => course.domains.includes(field)).map((course) => course.id)
  );
  const upstream = new Set([selected.id, ...upstreamOf(courseById, selected.id)]);
  const guests = new Set([...upstream].filter((id) => id !== selected.id && !visible.has(id)));
  const canvas = new Set([...visible, ...guests]);

  const edges: Edge[] = [];
  for (const id of upstream) {
    for (const dep of courseById.get(id)?.deps ?? []) {
      if (upstream.has(dep)) edges.push({ from: dep, to: id });
    }
  }
  if (!edges.length) continue;

  // What the selection opens up is not drawn, but it still decides where those
  // cards stand, so it goes into the ordering exactly as `ColumnsView` does it.
  const opened = (dependants.get(selected.id) ?? []).filter((id) => canvas.has(id));
  const placement: Edge[] = [...edges, ...opened.map((id) => ({ from: selected.id, to: id }))];

  const buckets = new Map<number, BuiltCourse[]>();
  for (const id of canvas) {
    const course = courseById.get(id)!;
    buckets.set(course.level, [...(buckets.get(course.level) ?? []), course]);
  }
  const shelved: Column[] = [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([level, list]) => ({ level, courses: list.sort((a, b) => a.row - b.row) }));

  const columns = placeGuests(shelved, guests, placement);
  const columnOf = new Map<string, number>();
  const rowOf = new Map<string, number>();
  columns.forEach((column, index) =>
    column.courses.forEach((course, row) => {
      columnOf.set(course.id, index);
      rowOf.set(course.id, row);
    })
  );

  // The cut to a tree the screen used to make: the nearest course that needs
  // this one, fewest columns to the right and then nearest row.
  const seat = (id: string) => ({ column: columnOf.get(id) ?? 0, row: rowOf.get(id) ?? 0 });
  const needs = new Map<string, string[]>();
  for (const edge of edges) needs.set(edge.from, [...(needs.get(edge.from) ?? []), edge.to]);
  const parentOf = new Map<string, string>();
  for (const [dep, dependantIds] of needs) {
    const here = seat(dep);
    parentOf.set(
      dep,
      dependantIds.reduce((best, id) => {
        const one = seat(id);
        const other = seat(best);
        if (one.column !== other.column) return one.column < other.column ? id : best;
        return Math.abs(one.row - here.row) < Math.abs(other.row - here.row) ? id : best;
      })
    );
  }
  const kept = (edge: Edge): boolean =>
    !parentOf.has(edge.from) || parentOf.get(edge.from) === edge.to;
  const tree = edges.filter(kept);
  const extra = edges.filter((edge) => !kept(edge));

  const treeTargets = new Set(tree.map((edge) => edge.to));
  const span = (edge: Edge): number => (columnOf.get(edge.to) ?? 0) - (columnOf.get(edge.from) ?? 0);
  const arriving = new Map<string, number>();
  for (const edge of edges) arriving.set(edge.to, (arriving.get(edge.to) ?? 0) + 1);
  const arrivingTree = new Map<string, number>();
  for (const edge of tree) arrivingTree.set(edge.to, (arrivingTree.get(edge.to) ?? 0) + 1);

  screens.push({
    id: selected.id,
    chain: upstream.size,
    tree: tree.length,
    full: edges.length,
    extra: extra.length,
    crossTree: crossings(tree, columnOf, rowOf),
    crossFull: crossings(edges, columnOf, rowOf),
    merged: extra.filter((edge) => treeTargets.has(edge.to)).length,
    long: extra.filter((edge) => span(edge) > 1).length,
    short: [...arriving].filter(([id, n]) => (arrivingTree.get(id) ?? 0) < n).length,
    rootShort: (arrivingTree.get(selected.id) ?? 0) < (arriving.get(selected.id) ?? 0),
  });
}

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);
const of = <K extends keyof Screen>(key: K): number[] => screens.map((screen) => Number(screen[key]));
const differ = screens.filter((screen) => screen.extra > 0);
const dirtier = screens.filter((screen) => screen.crossFull > screen.crossTree);
const share = (part: number, whole: number): string => `${((part / whole) * 100).toFixed(0)}%`;

console.log(`курсов с нарисованной цепочкой: ${screens.length} из ${courses.length}`);
console.log(
  `рисунок отличается: ${differ.length} (${share(differ.length, screens.length)})` +
    ` — цепочка в среднем ${(sum(differ.map((s) => s.chain)) / differ.length).toFixed(1)} карточек` +
    ` против ${(sum(screens.filter((s) => !s.extra).map((s) => s.chain)) / (screens.length - differ.length)).toFixed(1)}` +
    ` там, где не отличается`
);
console.log(
  `\nлиний: дерево ${sum(of('tree'))} → все связи ${sum(of('full'))}` +
    ` (+${sum(of('extra'))}, +${share(sum(of('extra')), sum(of('tree')))})` +
    `, где отличается — в среднем +${(sum(differ.map((s) => s.extra)) / differ.length).toFixed(1)},` +
    ` максимум +${Math.max(...differ.map((s) => s.extra))}`
);
console.log(
  `из ${sum(of('extra'))} добавленных линий ${sum(of('merged'))} (${share(sum(of('merged')), sum(of('extra')))})` +
    ` втекают в дорожку, которая уже нарисована, и ${sum(of('long'))} (${share(sum(of('long')), sum(of('extra')))})` +
    ` перепрыгивают колонку`
);
console.log(
  `\nпересечений: дерево ${sum(of('crossTree'))} → все связи ${sum(of('crossFull'))}` +
    ` (+${sum(of('crossFull')) - sum(of('crossTree'))})`
);
console.log(
  `экранов без единого пересечения: ${screens.filter((s) => !s.crossTree).length} → ` +
    `${screens.filter((s) => !s.crossFull).length};` +
    ` дорожает ${dirtier.length} (${share(dirtier.length, screens.length)})` +
    `, в среднем на ${(sum(dirtier.map((s) => s.crossFull - s.crossTree)) / dirtier.length).toFixed(1)}`
);
console.log(
  `\nчто прячет дерево: ${sum(of('short'))} карточек нарисованы с меньшим числом пререквизитов,` +
    ` чем у них есть — и выбранная карточка среди них ${screens.filter((s) => s.rootShort).length} раз`
);

if (process.argv[2] === 'worst') {
  console.log('');
  for (const screen of [...differ].sort((a, b) => b.extra - a.extra).slice(0, 20)) {
    console.log(
      `  ${screen.id.padEnd(28)} цепочка ${String(screen.chain).padStart(3)}` +
        `  линий ${String(screen.tree).padStart(3)} → ${String(screen.full).padStart(3)}` +
        `  пересечений ${screen.crossTree} → ${screen.crossFull}` +
        `  недорисовано карточек ${screen.short}`
    );
  }
}

/**
 * Crossings among a set of drawn edges, by the same test the ordering pass
 * optimises against — see `cross` in `lib/order.ts`, which is not exported
 * because nothing but that pass had a use for it until now.
 */
function crossings(
  drawn: Edge[],
  columnOf: Map<string, number>,
  rowOf: Map<string, number>
): number {
  const point = (id: string): [number, number] => [columnOf.get(id) ?? 0, rowOf.get(id) ?? 0];
  const side = (
    px: number,
    py: number,
    qx: number,
    qy: number,
    rx: number,
    ry: number
  ): number => Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));

  let total = 0;
  for (let i = 0; i < drawn.length; i++) {
    for (let j = i + 1; j < drawn.length; j++) {
      const a = drawn[i];
      const b = drawn[j];
      if (a.from === b.from || a.from === b.to || a.to === b.from || a.to === b.to) continue;
      const [ax, ay] = point(a.from);
      const [bx, by] = point(a.to);
      const [cx, cy] = point(b.from);
      const [dx, dy] = point(b.to);
      if (
        side(ax, ay, bx, by, cx, cy) * side(ax, ay, bx, by, dx, dy) < 0 &&
        side(cx, cy, dx, dy, ax, ay) * side(cx, cy, dx, dy, bx, by) < 0
      ) {
        total++;
      }
    }
  }
  return total;
}
