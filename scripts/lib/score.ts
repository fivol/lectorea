/**
 * How good a playlist is, out of what YouTube is willing to say.
 *
 * Dislikes have been private since 2021, so nothing on the page states quality
 * directly. Three things can be measured instead, and the whole design rests on
 * them being *independent* — measured across the catalogue, approval and
 * retention agree only 0.09, so together they say more than either twice:
 *
 *   approval   likes per view — did the people who came like it
 *   retention  views of the last quarter over the first — did they stay
 *   reach      views per lecture per subscriber — did it travel past its channel
 *
 * Each is worthless raw. A like meant a third as much in 2010 as in 2024, a big
 * channel gets fewer likes per view than a small one, and the shape of a view
 * curve says nothing until you know whether the playlist is a course at all.
 * So every signal is turned into a z-score against the right yardstick before
 * anything is added up. See `docs/rating.md` for the numbers behind each choice.
 */

/* ──────────────────────────────  Knobs  ─────────────────────────────── */

/**
 * Views at which a playlist's own numbers outweigh its peer group's.
 *
 * The old value of 5000 was set against a median playlist of 130 000 views and
 * therefore did nothing at all — half the catalogue had a prior weight under
 * 4%. This one bites where the noise actually is: at 2000 views a like rate is
 * still ±10%, below that it is a handful of people.
 */
export const CONFIDENCE_VIEWS = 2000;

/**
 * The same idea for the view curve, but counted per lecture.
 *
 * Retention is measured *between* videos, so what makes it noisy is not the
 * playlist's total but how many people saw each one: 4000 views spread over 41
 * lectures is 98 apiece, and the difference between the first quarter and the
 * last is then a few dozen people either way. Without this a playlist nobody
 * watched could be told it was watched to the end.
 */
export const CONFIDENCE_VIEWS_PER_VIDEO = 300;

/** Below this a playlist is not rated at all — the numbers are not evidence. */
export const SPARSE_VIEWS = 1000;
export const SPARSE_VIEWS_PER_VIDEO = 150;

/** Days since the last upload under which a playlist is still settling. */
export const FRESH_DAYS = 120;

/**
 * How much of a channel's habitual like rate is treated as the channel's
 * property rather than this playlist's merit.
 *
 * Zero ignores the channel; one flattens every channel to its own median and a
 * good channel loses everything that makes it good. A third leaves two thirds
 * of the advantage with the playlist — enough to stop a channel's audience
 * habits from being read as quality, not enough to punish a channel for being
 * consistently strong.
 */
export const CHANNEL_PULL = 0.35;

/** Playlists a channel needs before its own median is trusted over its peers'. */
export const CHANNEL_PRIOR = 4;

/** Weights of the rating. Reach is a badge, not a rank — see docs/rating.md. */
export const WEIGHTS = { approval: 0.5, retention: 0.5 } as const;

/**
 * What a rating built on one signal instead of two is worth.
 *
 * A playlist under eight lectures has no readable view curve, so its rating is
 * its approval alone — and a single extreme number is weaker evidence than two
 * moderate ones agreeing. Without this the top of the sorted list filled with
 * short playlists carried by one outlier, above courses that were merely good
 * at both things.
 */
export const SINGLE_SIGNAL_TRUST = 0.8;

/** Nothing may move the rating more than this, whatever the arithmetic says. */
export const Z_LIMIT = 3;

/**
 * Bounds a z-score without stacking everything up against the wall.
 *
 * A hard clamp put 60 playlists on exactly 2.40 and made the head of the sorted
 * list arbitrary — ties broken by title, in a place where the order is the whole
 * point. `tanh` is linear to within a percent below one sigma, where almost
 * everything lives, and bends the tail in without ever losing the order.
 */
export function saturate(z: number): number {
  return Z_LIMIT * Math.tanh(z / Z_LIMIT);
}

/** Videos with views a playlist needs before its curve can be read. */
export const MIN_CURVE_VIDEOS = 8;

/** Where a view curve stops being a course and becomes a pile of videos. */
export const CURVE = {
  seriesRho: -0.45,
  seriesScatter: 0.85,
  assortedRho: -0.25,
  assortedScatter: 1.2,
} as const;

/* ─────────────────────────────  Helpers  ────────────────────────────── */

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function quantile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Ranks with ties averaged — Spearman needs them, and ties are everywhere. */
function ranks(values: number[]): number[] {
  const order = values.map((value, index) => [value, index] as const).sort((a, b) => a[0] - b[0]);
  const result = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const average = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) result[order[k][1]] = average;
    i = j + 1;
  }
  return result;
}

function spearman(a: number[], b: number[]): number {
  const ra = ranks(a);
  const rb = ranks(b);
  const mean = (a.length + 1) / 2;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = ra[i] - mean;
    const y = rb[i] - mean;
    cov += x * y;
    va += x * x;
    vb += y * y;
  }
  return va && vb ? cov / Math.sqrt(va * vb) : 0;
}

/**
 * Centre and spread of a sample, both from quantiles.
 *
 * The mean and the standard deviation would be wrong here for one concrete
 * reason: the catalogue contains playlists whose like rate is 0.46 — real, and
 * forty times the median. One of them drags the mean of a whole peer group.
 * The IQR over 1.349 is the same thing as a standard deviation for a normal
 * sample and ignores the tails.
 */
export type Spread = { center: number; spread: number };

export function spreadOf(values: number[], floor = 0.12): Spread {
  return {
    center: median(values),
    spread: Math.max((quantile(values, 0.75) - quantile(values, 0.25)) / 1.349, floor),
  };
}

export function robustZ(value: number, { center, spread }: Spread): number {
  return (value - center) / spread;
}

/* ────────────────────────────  Raw signals  ─────────────────────────── */

export type Stats = { views: number; likes: number; comments: number };

/**
 * Likes per view.
 *
 * Comments used to be added to the numerator. They were dropped: they are 4%
 * of the sum, 205 playlists have them switched off entirely, and ranking by
 * likes alone agrees with the old sum at 0.997. All they contributed was noise
 * from a setting the lecturer chose.
 */
export function approvalOf({ views, likes }: Pick<Stats, 'views' | 'likes'>): number | null {
  if (views <= 0 || likes <= 0) return null;
  return Math.min(likes / views, MAX_PLAUSIBLE_APPROVAL);
}

/**
 * Past this a like rate is a broken counter, not an achievement.
 *
 * One playlist in the catalogue reports 10 638 likes against 24 076 views —
 * 44% of everyone who watched, four and a half times the next highest, and it
 * sat at the top of the whole catalogue. Clipped rather than dropped: whatever
 * happened to the counter, the playlist is still liked, just not impossibly so.
 */
export const MAX_PLAUSIBLE_APPROVAL = 0.15;

/**
 * Comments per view — a scale of its own, not a part of approval.
 *
 * Adding it into approval was the old mistake: it is a twentieth of that sum
 * and only moved the result by rounding. On its own it says something approval
 * does not, because writing a paragraph costs more than a tap, and a lecture
 * people argue under is a different thing from one people merely like. 205
 * playlists have comments switched off, and for those it is simply absent
 * rather than zero.
 */
export function discussionOf({ views, comments }: Pick<Stats, 'views' | 'comments'>): number | null {
  if (views <= 0 || comments <= 0) return null;
  return comments / views;
}

/** Kept for the list's own "engagement" column, which predates the rating. */
export function engagementOf({ views, likes, comments }: Stats): number {
  if (views <= 0) return 0;
  return (likes + comments) / views;
}

export type Curve = {
  /** Views of the last quarter over the first — 0.42 for a median playlist. */
  retention: number;
  /** Spearman of position against views. −1 is a course watched in order. */
  rho: number;
  /** Scatter of views around the decay trend. Large means arrivals are random. */
  scatter: number;
  /** Positions run newest-first, so the "tail" is really the oldest part. */
  reversed: boolean;
  kind: CurveKind;
};

export type CurveKind = 'series' | 'assorted' | 'unclear';

/**
 * Reads the shape of a playlist's view curve.
 *
 * A course is watched in order and loses people as it goes: views fall along
 * a power law and sit close to it. A subject bucket — a channel's «Astronomy»,
 * everything it ever filmed — is entered from search at a random point, so
 * position explains nothing and views scatter over two orders of magnitude.
 * Telling them apart matters twice: the bucket is worth saying out loud, and
 * its retention is meaningless and must not be scored.
 *
 * `views` must be in playlist order. Videos whose views are missing are
 * dropped rather than counted as zero.
 */
export function curveOf(views: Array<number | null | undefined>, chronological = true): Curve | null {
  const series = views.filter((value): value is number => typeof value === 'number' && value > 0);
  if (series.length < MIN_CURVE_VIDEOS) return null;

  const positions = series.map((_, index) => index);
  const rho = spearman(positions, series);

  const logViews = series.map((value) => Math.log(value));
  const logRank = series.map((_, index) => Math.log(index + 1));
  const centerX = median(logRank);
  const centerY = median(logViews);
  let cov = 0;
  let variance = 0;
  for (let i = 0; i < series.length; i++) {
    cov += (logRank[i] - centerX) * (logViews[i] - centerY);
    variance += (logRank[i] - centerX) ** 2;
  }
  const slope = variance ? cov / variance : 0;
  const residuals = logViews.map((value, i) => value - (centerY + slope * (logRank[i] - centerX)));
  const residualCenter = median(residuals);
  const scatter = median(residuals.map((value) => Math.abs(value - residualCenter))) * 1.4826;

  const quarter = Math.max(2, Math.round(series.length * 0.25));
  const head = median(series.slice(0, quarter));
  const tail = median(series.slice(-quarter));
  const raw = head > 0 ? tail / head : 1;
  // 67 playlists in the catalogue are ordered newest-first. Read literally they
  // look like courses people finish more eagerly than they start.
  const retention = clamp(chronological ? raw : raw > 0 ? 1 / raw : 1, 0.02, 3);

  return { retention, rho, scatter, reversed: !chronological, kind: curveKind(rho, scatter) };
}

/**
 * True when a playlist runs newest-first.
 *
 * Only a clear majority counts. Half the catalogue is in no date order at all
 * — which is harmless, since position is the order it gets watched in — and a
 * playlist that merely wanders would otherwise be flipped on a coin toss.
 */
export function isReversed(dates: string[]): boolean {
  if (dates.length < 3) return false;
  let increasing = 0;
  for (let i = 1; i < dates.length; i++) if (dates[i] >= dates[i - 1]) increasing++;
  return increasing / (dates.length - 1) <= 0.1;
}

export function curveKind(rho: number, scatter: number): CurveKind {
  if (rho <= CURVE.seriesRho && scatter <= CURVE.seriesScatter) return 'series';
  if (rho >= CURVE.assortedRho || scatter >= CURVE.assortedScatter) return 'assorted';
  return 'unclear';
}

/**
 * Views per lecture per subscriber — how far past its own channel it went.
 *
 * Raw views cannot answer that: they measure the size of the channel more than
 * anything about the playlist, and putting them in the rank brought back the
 * bias the whole rewrite exists to remove (a 0.30 rank correlation with views).
 * Divided by subscribers, the same number says something a small channel can
 * also win.
 */
export function reachOf(
  views: number,
  videoCount: number,
  subscribers: number | null | undefined
): number | null {
  if (views <= 0 || videoCount <= 0 || !subscribers || subscribers <= 0) return null;
  return views / videoCount / subscribers;
}

/* ──────────────────────────  Peer calibration  ──────────────────────── */

/**
 * What a like is worth in this corner of the catalogue.
 *
 * Not "who your competitors are" — a 2011 English course still competes with
 * everything. It is the unit: the median like rate is 0.0057 for English
 * before 2013 and 0.0193 for English after 2022, a factor of 3.4 that has
 * nothing to do with the lecturer. Without this the rating measures the
 * calendar; with it, the rank correlation with year falls from 0.49 to 0.01.
 */
export function peerKey(lang: string, year: number | undefined): string {
  const era = !year
    ? 'unknown'
    : year <= 2012
      ? '..2012'
      : year <= 2015
        ? '2013-15'
        : year <= 2018
          ? '2016-18'
          : year <= 2021
            ? '2019-21'
            : '2022..';
  return `${lang}|${era}`;
}

/** Peer groups smaller than this fall back on the catalogue as a whole. */
export const MIN_PEER_GROUP = 25;

export function peerSpreads(items: Array<{ key: string; value: number }>): {
  byKey: Map<string, Spread>;
  overall: Spread;
} {
  const grouped = new Map<string, number[]>();
  for (const { key, value } of items) {
    const list = grouped.get(key) ?? [];
    list.push(Math.log(value));
    grouped.set(key, list);
  }
  const overall = spreadOf([...grouped.values()].flat());
  const byKey = new Map<string, Spread>();
  for (const [key, values] of grouped) {
    byKey.set(key, values.length >= MIN_PEER_GROUP ? spreadOf(values) : overall);
  }
  return { byKey, overall };
}

/**
 * How much better or worse a channel does than its peers, shrunk by evidence.
 *
 * A channel with two playlists says almost nothing about itself and is pulled
 * back to zero; a channel with forty is taken at its word. What comes out is
 * subtracted from its playlists only in part — see CHANNEL_PULL.
 */
export function channelDeviations(
  items: Array<{ channelId: string; deviation: number }>
): Map<string, number> {
  const grouped = new Map<string, number[]>();
  for (const { channelId, deviation } of items) {
    const list = grouped.get(channelId) ?? [];
    list.push(deviation);
    grouped.set(channelId, list);
  }
  const result = new Map<string, number>();
  for (const [channelId, deviations] of grouped) {
    const weight = deviations.length / (deviations.length + CHANNEL_PRIOR);
    result.set(channelId, median(deviations) * weight);
  }
  return result;
}

/* ───────────────────────────────  Rating  ───────────────────────────── */

export type RatingParts = {
  approval: number | null;
  retention: number | null;
  reach: number | null;
};

/**
 * One number for the sort, from whichever parts exist.
 *
 * Averaging over what is present rather than treating a missing signal as zero:
 * a seven-lecture playlist has no readable curve, and scoring it as if its
 * audience walked out would be a lie about a fact we do not have.
 */
export function ratingOf(parts: RatingParts): number | null {
  const present: Array<[number, number]> = [];
  if (parts.approval !== null) present.push([parts.approval, WEIGHTS.approval]);
  if (parts.retention !== null) present.push([parts.retention, WEIGHTS.retention]);
  if (!present.length) return null;
  const total = present.reduce((sum, [, weight]) => sum + weight, 0);
  const mean = present.reduce((sum, [value, weight]) => sum + value * weight, 0) / total;
  return present.length > 1 ? mean : mean * SINGLE_SIGNAL_TRUST;
}

/* ───────────────────────────────  Status  ───────────────────────────── */

/**
 * The one word the list shows.
 *
 * Deliberately all neutral or positive. The rating can honestly say "this one
 * is loved and finished"; it cannot say "this one is bad" — the same low like
 * rate is earned by NPTEL, whose audience simply does not press the button,
 * and by a genuinely dull recording, and nothing in the data separates them.
 * So a weak playlist gets no word at all and sinks in the sort, which is the
 * true statement, and «Подборка» describes a shape rather than a verdict.
 */
export const STATUS_ORDER = [
  'sparse',
  'fresh',
  'excellent',
  'classic',
  'retained',
  'liked',
  'discussed',
  'reaching',
  'assorted',
  'none',
] as const;

export type PlaylistStatus = (typeof STATUS_ORDER)[number];

/** The rungs that are earned by a number, in the order they are tried. */
export const EARNED = ['excellent', 'classic', 'retained', 'liked', 'discussed', 'reaching'] as const;
export type EarnedStatus = (typeof EARNED)[number];
export type StatusThresholds = Record<EarnedStatus, number>;

export type StatusInput = {
  views: number;
  videoCount: number;
  year: number | undefined;
  lastVideoAt: string | null | undefined;
  rating: number | null;
  approvalZ: number | null;
  retentionZ: number | null;
  discussionZ: number | null;
  reachZ: number | null;
  curve: CurveKind | null;
};

/**
 * How much of its own candidates each word takes — "the top quarter of the
 * playlists this rung could possibly describe".
 *
 * Shares rather than cut-offs, because a z of 1.2 means whatever this year's
 * population makes it mean, and a badge nobody wears is as useless as one
 * everybody wears. Shares of *candidates* rather than of the catalogue, because
 * the rungs are tried in order and the lower ones are left with whatever the
 * upper ones did not want: measured against the catalogue, «Разошёлся» came out
 * at 0.4% — not because few playlists travel far, but because the four rungs
 * above it had already claimed them. So every rung is cut against everyone it
 * applies to, overlaps and all, and the priority order below merely decides
 * which of several true words gets said.
 */
export const STATUS_TARGETS: Record<EarnedStatus, number> = {
  excellent: 0.6,
  classic: 0.75,
  retained: 0.65,
  liked: 0.65,
  discussed: 0.5,
  reaching: 0.6,
};

/**
 * What each rung asks for, beyond clearing its threshold.
 *
 * `sound` — the rating as a whole is not negative — guards every single-signal
 * word. Without it «Разошёлся» landed on a playlist a full two sigma below its
 * peers on approval, which is a compliment the data did not make.
 */
type Rung = {
  key: EarnedStatus;
  /** The number this rung is ranked by. Null means the rung does not apply. */
  metric: (input: StatusInput) => number | null;
  eligible: (input: StatusInput) => boolean;
};

const sound = (input: StatusInput): boolean => (input.rating ?? 0) >= 0;

/**
 * Said before any of the single scales, because each is a claim the others
 * cannot make: one is about being good at everything, the other about having
 * lasted. Order between them is fixed.
 */
export const COMPOUND_RUNGS: Rung[] = [
  {
    key: 'excellent',
    metric: (input) => input.rating,
    // Two independent things at once, so it must have both and be contradicted
    // by neither: retention alone used to carry playlists over this line whose
    // approval was a full sigma below their peers.
    eligible: (input) =>
      input.approvalZ !== null &&
      input.retentionZ !== null &&
      input.approvalZ >= 0 &&
      input.retentionZ >= 0,
  },
  {
    key: 'classic',
    // Old and still being found. Ranked by reach so "still watched" means
    // watched relative to its channel, not merely published by a large one.
    metric: (input) => input.reachZ,
    eligible: (input) => sound(input) && (input.year ?? 9999) <= CLASSIC_YEAR,
  },
];

/**
 * The four single scales. Not a priority list — whichever one the playlist
 * clears by the widest margin wins.
 *
 * They were a priority list at first, and it does not work: every rung sees
 * only what the rungs above it refused, so the last one described 0.4% of the
 * catalogue — not because few playlists travel far, but because «Отличный»,
 * «Классика», «Досматривают» and «Нравится» had already spoken for them. The
 * margins are directly comparable, all four being z-scores over their own
 * threshold, so "the thing this playlist is most unusual for" is a question
 * with an answer, and it is a better answer than an order fixed in advance.
 */
export const SIGNAL_RUNGS: Rung[] = [
  { key: 'retained', metric: (input) => input.retentionZ, eligible: sound },
  { key: 'liked', metric: (input) => input.approvalZ, eligible: sound },
  { key: 'discussed', metric: (input) => input.discussionZ, eligible: sound },
  { key: 'reaching', metric: (input) => input.reachZ, eligible: sound },
];

export const RUNGS: Rung[] = [...COMPOUND_RUNGS, ...SIGNAL_RUNGS];

/** Recorded this year or earlier, and still watched, is a classic. */
export const CLASSIC_YEAR = 2016;

/**
 * The one word, chosen in three steps.
 *
 * First the gates, in order, because each outranks anything built on top of it:
 * that the numbers are not evidence beats any praise drawn from them, that a
 * playlist is still being uploaded beats a verdict on figures still moving, and
 * that it is a subject bucket rather than a course beats a course word.
 *
 * Then the two compound claims, in order. Then, of the four single scales, the
 * one the playlist clears by the widest margin — the thing it is most unusual
 * for. Nothing at all if it cleared none, which is most of the catalogue and
 * the honest answer for it.
 */
export function statusOf(
  input: StatusInput,
  thresholds: StatusThresholds,
  now: Date
): PlaylistStatus {
  const perVideo = input.videoCount > 0 ? input.views / input.videoCount : 0;
  if (input.views < SPARSE_VIEWS || perVideo < SPARSE_VIEWS_PER_VIDEO) return 'sparse';

  if (input.lastVideoAt) {
    const days = (now.getTime() - Date.parse(input.lastVideoAt)) / 864e5;
    if (Number.isFinite(days) && days >= 0 && days < FRESH_DAYS) return 'fresh';
  }

  // Ahead of every earned word, because it is a different kind of statement.
  // «Нравится» on a channel's 878-video «Biology» bucket is true and useless:
  // what the reader needs to know first is that it is not a course to work
  // through. Left at the foot of the ladder, the head of the sorted catalogue
  // filled with well-liked buckets wearing course words.
  if (input.curve === 'assorted') return 'assorted';

  for (const rung of COMPOUND_RUNGS) {
    if (!rung.eligible(input)) continue;
    const value = rung.metric(input);
    if (value !== null && value >= thresholds[rung.key]) return rung.key;
  }

  let best: EarnedStatus | null = null;
  let widest = 0;
  for (const rung of SIGNAL_RUNGS) {
    if (!rung.eligible(input)) continue;
    const value = rung.metric(input);
    if (value === null) continue;
    const margin = value - thresholds[rung.key];
    if (margin >= 0 && margin > widest) {
      widest = margin;
      best = rung.key;
    }
  }
  return best ?? 'none';
}

/** Unreachable cuts, so `statusOf` reports only what the gates above decided. */
const NO_THRESHOLDS: StatusThresholds = Object.fromEntries(
  EARNED.map((key) => [key, Infinity])
) as StatusThresholds;

/**
 * Cuts that hand each rung the share of its own candidates it was asked for.
 *
 * The pool is what the gates leave behind — a threshold set over playlists that
 * a gate has already spoken for is a threshold met by fewer than it promises.
 * Within the pool the rungs do not take turns: each is cut against everyone it
 * could describe, so a playlist may clear three of them and the priority order
 * in `statusOf` decides which of the three true things gets said.
 */
export function thresholdsFor(inputs: StatusInput[], now: Date): StatusThresholds {
  const pool = inputs.filter((input) => statusOf(input, NO_THRESHOLDS, now) === 'none');

  const thresholds = {} as StatusThresholds;
  for (const rung of RUNGS) {
    const values = pool
      .filter((input) => rung.eligible(input) && rung.metric(input) !== null)
      .map((input) => rung.metric(input)!)
      .sort((a, b) => b - a);
    const want = Math.round(STATUS_TARGETS[rung.key] * values.length);
    // Nobody can reach it rather than everybody: a rung with no candidates must
    // stay empty, not swallow the pool on the next build.
    thresholds[rung.key] = want > 0 ? values[want - 1] : Infinity;
  }
  return thresholds;
}

/* ─────────────────────────  The whole catalogue  ────────────────────── */

export type Rateable = {
  id: string;
  channelId: string;
  lang: string;
  year?: number;
  videoCount: number;
  stats: Stats;
  retention?: number;
  curve?: CurveKind;
  lastVideoAt?: string;
};

export type Rated = {
  rating: number;
  status: PlaylistStatus;
  signals: {
    approval: number | null;
    retention: number | null;
    discussion: number | null;
    reach: number | null;
  };
};

/**
 * Scores every playlist against every other one, in one pass over the lot.
 *
 * It has to be all of them at once: a z-score is a statement about a
 * population, and the population is the catalogue. Doing it per course would
 * mean a mediocre playlist in a thin course outranking a strong one in a
 * crowded course, which is exactly backwards.
 */
export function rateCatalogue(
  items: Rateable[],
  subscribersOf: (channelId: string) => number | null,
  now: Date = new Date()
): { byId: Map<string, Rated>; thresholds: StatusThresholds } {
  const approval = new Map<string, number>();
  for (const item of items) {
    const value = approvalOf(item.stats);
    if (value !== null) approval.set(item.id, value);
  }

  const peers = peerSpreads(
    items
      .filter((item) => approval.has(item.id))
      .map((item) => ({ key: peerKey(item.lang, item.year), value: approval.get(item.id)! }))
  );
  const peerOf = (item: Rateable): Spread =>
    peers.byKey.get(peerKey(item.lang, item.year)) ?? peers.overall;

  const channels = channelDeviations(
    items
      .filter((item) => approval.has(item.id))
      .map((item) => ({
        channelId: item.channelId,
        deviation: Math.log(approval.get(item.id)!) - peerOf(item).center,
      }))
  );

  const approvalZ = new Map<string, number>();
  for (const item of items) {
    const value = approval.get(item.id);
    if (value === undefined) continue;
    const peer = peerOf(item);
    // The channel's habits are removed only in part: all of it would flatten a
    // consistently good channel to its own median and call that neutrality.
    const center = peer.center + CHANNEL_PULL * (channels.get(item.channelId) ?? 0);
    const raw = robustZ(Math.log(value), { center, spread: peer.spread });
    const views = Math.max(0, item.stats.views);
    approvalZ.set(item.id, saturate(raw * (views / (views + CONFIDENCE_VIEWS))));
  }

  // A subject bucket's retention is an artefact of how people arrive at it,
  // not of whether they stayed, so it is neither normalised nor scored.
  const scorable = items.filter((item) => item.retention && item.curve !== 'assorted');
  // Peers here too, for the same reason: Russian university recordings hold
  // their audience half a sigma better than the English catalogue's mixture of
  // courses and channel series, which is a fact about the two populations and
  // not about any one lecturer.
  const retentionPeers = peerSpreads(
    scorable.map((item) => ({ key: peerKey(item.lang, item.year), value: item.retention! }))
  );
  const retentionZ = new Map<string, number>();
  for (const item of scorable) {
    const peer =
      retentionPeers.byKey.get(peerKey(item.lang, item.year)) ?? retentionPeers.overall;
    const raw = robustZ(Math.log(item.retention!), peer);
    const perVideo = item.videoCount > 0 ? item.stats.views / item.videoCount : 0;
    const confidence = perVideo / (perVideo + CONFIDENCE_VIEWS_PER_VIDEO);
    retentionZ.set(item.id, saturate(raw * confidence));
  }

  // Discussion carries the same calendar and language drift as approval — a
  // comment section in 2010 was a different place — so it gets the same peers.
  const discussion = new Map<string, number>();
  for (const item of items) {
    const value = discussionOf(item.stats);
    if (value !== null) discussion.set(item.id, value);
  }
  const discussionPeers = peerSpreads(
    items
      .filter((item) => discussion.has(item.id))
      .map((item) => ({ key: peerKey(item.lang, item.year), value: discussion.get(item.id)! }))
  );
  const discussionZ = new Map<string, number>();
  for (const [id, value] of discussion) {
    const item = items.find((candidate) => candidate.id === id)!;
    const peer = discussionPeers.byKey.get(peerKey(item.lang, item.year)) ?? discussionPeers.overall;
    const views = Math.max(0, item.stats.views);
    const raw = robustZ(Math.log(value), peer) * (views / (views + CONFIDENCE_VIEWS));
    discussionZ.set(id, saturate(raw));
  }

  const reach = new Map<string, number>();
  for (const item of items) {
    const value = reachOf(item.stats.views, item.videoCount, subscribersOf(item.channelId));
    if (value !== null) reach.set(item.id, value);
  }
  const reachSpread = spreadOf([...reach.values()].map((value) => Math.log(value)));
  const reachZ = new Map<string, number>();
  for (const [id, value] of reach) {
    reachZ.set(id, saturate(robustZ(Math.log(value), reachSpread)));
  }

  const ratings = new Map<string, number>();
  for (const item of items) {
    const value = ratingOf({
      approval: approvalZ.get(item.id) ?? null,
      retention: retentionZ.get(item.id) ?? null,
      reach: reachZ.get(item.id) ?? null,
    });
    ratings.set(item.id, value ?? -Z_LIMIT);
  }

  const inputs = new Map<string, StatusInput>();
  for (const item of items) {
    inputs.set(item.id, {
      views: item.stats.views,
      videoCount: item.videoCount,
      year: item.year,
      lastVideoAt: item.lastVideoAt,
      rating: ratings.get(item.id)!,
      approvalZ: approvalZ.get(item.id) ?? null,
      retentionZ: retentionZ.get(item.id) ?? null,
      discussionZ: discussionZ.get(item.id) ?? null,
      reachZ: reachZ.get(item.id) ?? null,
      curve: item.curve ?? null,
    });
  }
  const thresholds = thresholdsFor([...inputs.values()], now);

  const byId = new Map<string, Rated>();
  for (const item of items) {
    byId.set(item.id, {
      rating: ratings.get(item.id)!,
      signals: {
        approval: approvalZ.get(item.id) ?? null,
        retention: retentionZ.get(item.id) ?? null,
        discussion: discussionZ.get(item.id) ?? null,
        reach: reachZ.get(item.id) ?? null,
      },
      status: statusOf(inputs.get(item.id)!, thresholds, now),
    });
  }
  return { byId, thresholds };
}

export { clamp, quantile };
