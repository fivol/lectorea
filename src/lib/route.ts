/**
 * Turning a pair of cards into a line on the canvas.
 *
 * One drawing: right angles down the gaps — see `routeSteps`. It needs to know
 * the whole board, because where the gaps between columns and between rows are
 * is a fact about every card on screen rather than about the two being joined.
 * A single cubic from edge to edge was the other answer and was offered beside
 * this one for a while; it went because the merge into a shared lane is what
 * makes a fork legible, and a picture that says something different depending
 * on a switch is two pictures.
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
  // No card measured means no box either, so there is nothing to join.
  if (!cards.length) return [];

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
  type Lane = { low: number; high: number; tails: number[] };
  const runs = new Map<number, Map<string, Lane>>();
  const note = (gap: number, key: string, from: number, tail: number): void => {
    const lanes = runs.get(gap) ?? new Map<string, Lane>();
    const had = lanes.get(key);
    const low = Math.min(from, tail);
    const high = Math.max(from, tail);
    lanes.set(
      key,
      had
        ? { low: Math.min(had.low, low), high: Math.max(had.high, high), tails: [...had.tails, tail] }
        : { low, high, tails: [tail] }
    );
    runs.set(gap, lanes);
  };
  for (const plan of plans) {
    // The tail is where the run stops descending and turns right again, which
    // is the height at which it can be cut by somebody else's descent.
    note(plan.inGap, plan.leg.to, plan.channel ?? plan.y1, plan.y2);
    if (plan.outGap !== null && plan.channel !== null) {
      note(plan.outGap, plan.leg.from, plan.y1, plan.channel);
    }
  }

  const laneAt = new Map<string, number>();
  for (const [gap, lanes] of runs) {
    const left = columns[gap] + width;
    const right = columns[gap + 1] ?? left + LANE_SPACING * 2;
    const low = left + RADIUS;
    const high = right - RADIUS;
    /**
     * A run whose descent would cut another's tail goes on the outside of it.
     *
     * Ordering by the height a run arrives at is the obvious rule and it is
     * backwards. Five courses fanning out of one card leave along the same
     * line and peel off it one at a time; whichever peels off last has to run
     * its vertical across every tail that peeled off before it, so every pair
     * of them crosses — six crossings for the five that hang off algorithms.
     * Turned round, the card furthest away leaves first and its descent is
     * clear of the rest.
     *
     * «Furthest first» is only the common shape of the real rule, though, and
     * on its own it made nine other chains worse. What decides it is whether
     * one run's tail lies inside the other's descent: if it does, the descent
     * has to be the one further from the cards, or it cuts the tail. Ties, and
     * pairs where neither contains the other, fall back to the longer run
     * first, which is the fan.
     */
    const cuts = (over: Lane, under: Lane): boolean =>
      under.tails.some((tail) => tail > over.low + FLAT && tail < over.high - FLAT);
    const ordered = [...lanes.entries()].sort(([keyA, a], [keyB, b]) => {
      const aCutsB = cuts(a, b);
      const bCutsA = cuts(b, a);
      if (aCutsB !== bCutsA) return aCutsB ? -1 : 1;
      return (
        b.high - b.low - (a.high - a.low) ||
        (a.low + a.high) / 2 - (b.low + b.high) / 2 ||
        keyA.localeCompare(keyB)
      );
    });
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
const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));
const p = (value: number): string => value.toFixed(1);
