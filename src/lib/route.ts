/**
 * Turning a pair of cards into a line on the canvas.
 *
 * Two drawings, and the reader picks between them — see `steppedLines`. Curves
 * are one cubic from edge to edge and need nothing but the two boxes. Steps need
 * to know the whole board: a right-angled line runs down the gaps between
 * columns and across the gaps between rows, and where those gaps are is a fact
 * about every card on screen rather than about the two being joined.
 *
 * Geometry in, path strings out. Nothing here touches the DOM — `ChainLinks`
 * measures, this decides — which is what makes it possible to reason about a
 * route without a browser.
 */

export type Rect = { left: number; right: number; top: number; bottom: number };
export type Leg = { from: string; to: string; depth: number };
export type Path = { key: string; d: string; length: number; depth: number };

/** Corner radius where a run turns. */
const RADIUS = 10;
/** Below this the two cards are level with each other. */
const FLAT = 6;
/**
 * The most two neighbouring lanes are ever pushed apart.
 *
 * At 12px two lanes descending past each other read as one thick line that has
 * gone wrong rather than as two lines — near enough to look like a mistake, far
 * enough not to be the deliberate overlap of a shared trunk. The gap is wide
 * enough to put real distance between them, so it does.
 */
const LANE_SPACING = 24;
/** Two runs sharing a row channel keep at least this much clear of each other. */
const CLEARANCE = 24;

export function routeCurves(legs: Leg[], boxes: Map<string, Rect>): Path[] {
  const out: Path[] = [];
  for (const leg of legs) {
    const from = boxes.get(leg.from);
    const to = boxes.get(leg.to);
    if (!from || !to) continue;

    const x1 = from.right;
    const y1 = mid(from);
    const x2 = to.left;
    const y2 = mid(to);
    // A horizontal pull proportional to the gap: short hops stay gentle, long
    // ones bow out far enough not to run along the cards in between.
    const pull = Math.max(24, (x2 - x1) * 0.5);
    out.push({
      key: `${leg.from}->${leg.to}`,
      d:
        `M${p(x1)} ${p(y1)} C${p(x1 + pull)} ${p(y1)}, ` +
        `${p(x2 - pull)} ${p(y2)}, ${p(x2)} ${p(y2)}`,
      length: Math.hypot(x2 - x1, y2 - y1) + pull,
      depth: leg.depth,
    });
  }
  return out;
}

/**
 * Every line at right angles, and none of them over a card.
 *
 * A line between neighbouring columns has one gap to work with: out of the
 * source's edge, along to a lane inside that gap, down the lane, and into the
 * target's edge. Lanes are keyed by the card at the end rather than by the line,
 * so everything arriving at one course comes down one lane and merges at its
 * edge — the fork a chain actually has — while separate targets sharing a gap
 * get lanes of their own and stop overlapping.
 *
 * A line that skips a column is the case a single curve could not draw without
 * sweeping diagonally across whatever stood in between, which is what this
 * replaced. It gets two lanes and a row channel: down the gap to the right of
 * the source, across the horizontal gap *between* two rows of cards, then down
 * the gap to the left of the target. Rows line up across columns — `row` is an
 * index and every card is the same height — so a channel that is clear in one
 * column is clear in all of them, and the line passes between the cards rather
 * than over them.
 *
 * Two long lines wanting the same channel are pushed onto different ones when
 * their spans overlap. Crossings are not eliminated — the order of the cards
 * decides most of those, and that is `placeGuests`'s job — but a route never
 * adds one it did not have to.
 */
export function routeSteps(legs: Leg[], boxes: Map<string, Rect>, cards: Rect[]): Path[] {
  if (!cards.length) return routeCurves(legs, boxes);

  const columns = spread(cards.map((card) => card.left));
  const width = cards[0].right - cards[0].left;
  const channels = rowChannels(cards);

  type Plan = {
    leg: Leg;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    /** Gap the line descends in on its way *into* the target. */
    inGap: number;
    /** Gap it descends in on the way *out* of the source, when it skips a column. */
    outGap: number | null;
    channel: number | null;
  };

  const gapIndex = (left: number): number => nearest(columns, left);
  const plans: Plan[] = [];

  for (const leg of legs) {
    const from = boxes.get(leg.from);
    const to = boxes.get(leg.to);
    if (!from || !to) continue;

    const source = gapIndex(from.left);
    const target = gapIndex(to.left);
    if (target <= source) continue;

    plans.push({
      leg,
      x1: from.right,
      y1: mid(from),
      x2: to.left,
      y2: mid(to),
      inGap: target - 1,
      outGap: target > source + 1 ? source : null,
      channel: null,
    });
  }

  // A channel is claimed with the span it occupies, so the next long line that
  // wants it is pushed to another one rather than laid on top.
  const claimed = new Map<number, Array<[number, number]>>();
  for (const plan of plans) {
    if (plan.outGap === null) continue;
    const low = Math.min(plan.x1, plan.x2);
    const high = Math.max(plan.x1, plan.x2);
    const wanted = [...channels].sort(
      (a, b) => preference(a, plan.y1, plan.y2) - preference(b, plan.y1, plan.y2)
    );
    const free = wanted.find((y) =>
      (claimed.get(y) ?? []).every(([a, b]) => high < a - CLEARANCE || low > b + CLEARANCE)
    );
    const chosen = free ?? wanted[0];
    plan.channel = chosen;
    claimed.set(chosen, [...(claimed.get(chosen) ?? []), [low, high]]);
  }

  /**
   * Lanes inside each gap.
   *
   * One per card at the end of a run — the target for a run arriving, the
   * source for a run leaving — so everything feeding one course comes down the
   * same lane and merges into its edge, which is the fork a chain actually has.
   * Two lines therefore share a stretch of lane where they are on their way to
   * the same place, and that is the drawing rather than a collision: separate
   * targets sharing a gap do get lanes of their own, which is what the gap was
   * widened to hold. Ordered by the height they sit at, so lanes do not cross
   * each other on the way in.
   */
  const runs = new Map<number, Map<string, number[]>>();
  const note = (gap: number, key: string, y: number): void => {
    const lanes = runs.get(gap) ?? new Map<string, number[]>();
    lanes.set(key, [...(lanes.get(key) ?? []), y]);
    runs.set(gap, lanes);
  };
  for (const plan of plans) {
    note(plan.inGap, plan.leg.to, plan.y2);
    if (plan.outGap !== null) note(plan.outGap, plan.leg.from, plan.y1);
  }

  const laneAt = new Map<string, number>();
  for (const [gap, lanes] of runs) {
    const left = columns[gap] + width;
    const right = columns[gap + 1] ?? left + LANE_SPACING * 2;
    const low = left + RADIUS;
    const high = right - RADIUS;
    const ordered = [...lanes.entries()].sort(
      (a, b) => average(a[1]) - average(b[1]) || a[0].localeCompare(b[0])
    );
    for (const [index, [key]] of ordered.entries()) {
      if (low >= high) {
        laneAt.set(`${gap}:${key}`, (left + right) / 2);
        continue;
      }
      const centre = (low + high) / 2;
      const spacing =
        ordered.length > 1 ? Math.min(LANE_SPACING, (high - low) / (ordered.length - 1)) : 0;
      const offset = (index - (ordered.length - 1) / 2) * spacing;
      laneAt.set(`${gap}:${key}`, clamp(centre + offset, low, high));
    }
  }

  const out: Path[] = [];
  for (const plan of plans) {
    const { leg, x1, y1, x2, y2 } = plan;
    const inLane = laneAt.get(`${plan.inGap}:${leg.to}`) ?? (x1 + x2) / 2;

    // Level with each other and next door: nothing to turn for.
    if (plan.outGap === null && Math.abs(y2 - y1) < FLAT) {
      out.push({
        key: `${leg.from}->${leg.to}`,
        d: `M${p(x1)} ${p(y1)} H${p(x2)}`,
        length: x2 - x1,
        depth: leg.depth,
      });
      continue;
    }

    // Out of the card, down a lane, and in — with a run along a row channel in
    // between when the line has a column to get past.
    const turns: Array<[number, number]> = [];
    if (plan.outGap !== null && plan.channel !== null) {
      const outLane = laneAt.get(`${plan.outGap}:${leg.from}`) ?? x1 + RADIUS * 2;
      turns.push([outLane, y1], [outLane, plan.channel], [inLane, plan.channel], [inLane, y2]);
    } else {
      turns.push([inLane, y1], [inLane, y2]);
    }

    out.push({
      key: `${leg.from}->${leg.to}`,
      d: elbows([x1, y1], turns, [x2, y2]),
      length: run([x1, y1], turns, [x2, y2]),
      depth: leg.depth,
    });
  }

  return out;
}

/**
 * A path through a list of turns, each corner rounded by as much as it can
 * afford. The turns alternate horizontal and vertical by construction, so a
 * corner only ever has to give way to the shorter of the two runs meeting in it.
 */
function elbows(start: [number, number], turns: Array<[number, number]>, end: [number, number]): string {
  const points = [start, ...turns, end];
  let d = `M${p(points[0][0])} ${p(points[0][1])}`;

  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1];
    const [cx, cy] = points[i];
    const [nx, ny] = points[i + 1];
    const into = Math.hypot(cx - px, cy - py);
    const away = Math.hypot(nx - cx, ny - cy);
    const radius = Math.min(RADIUS, into / 2, away / 2);
    if (radius < 0.5) {
      d += ` L${p(cx)} ${p(cy)}`;
      continue;
    }
    const before: [number, number] = [
      cx - Math.sign(cx - px) * radius,
      cy - Math.sign(cy - py) * radius,
    ];
    const after: [number, number] = [
      cx + Math.sign(nx - cx) * radius,
      cy + Math.sign(ny - cy) * radius,
    ];
    d += ` L${p(before[0])} ${p(before[1])} Q${p(cx)} ${p(cy)}, ${p(after[0])} ${p(after[1])}`;
  }

  const last = points[points.length - 1];
  return `${d} L${p(last[0])} ${p(last[1])}`;
}

function run(start: [number, number], turns: Array<[number, number]>, end: [number, number]): number {
  const points = [start, ...turns, end];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return total;
}

/**
 * The clear horizontal lines between one row of cards and the next, plus one
 * above the first row and one below the last. Rows line up across columns, so
 * these are the same in every column — which is what a long line runs along.
 */
function rowChannels(cards: Rect[]): number[] {
  const tops = spread(cards.map((card) => card.top));
  const height = cards[0].bottom - cards[0].top;
  const between = tops.length > 1 ? tops[1] - (tops[0] + height) : 20;
  const channels = [tops[0] - between / 2];
  for (let i = 1; i < tops.length; i++) channels.push((tops[i - 1] + height + tops[i]) / 2);
  channels.push(tops[tops.length - 1] + height + between / 2);
  return channels;
}

/** Between the two ends is best, and nearest their midpoint best of those. */
function preference(channel: number, y1: number, y2: number): number {
  const low = Math.min(y1, y2);
  const high = Math.max(y1, y2);
  const inside = channel > low + FLAT && channel < high - FLAT;
  return (inside ? 0 : 1e6) + Math.abs(channel - (y1 + y2) / 2);
}

/** Distinct values, in order — the columns' lefts or the rows' tops. */
function spread(values: number[]): number[] {
  const seen: number[] = [];
  for (const value of [...values].sort((a, b) => a - b)) {
    if (!seen.length || Math.abs(seen[seen.length - 1] - value) > 1) seen.push(value);
  }
  return seen;
}

function nearest(values: number[], value: number): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) {
    if (Math.abs(values[i] - value) < Math.abs(values[best] - value)) best = i;
  }
  return best;
}

const mid = (rect: Rect): number => rect.top + (rect.bottom - rect.top) / 2;
const average = (values: number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;
const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));
const p = (value: number): string => value.toFixed(1);
