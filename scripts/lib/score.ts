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

/**
 * What the curve alone gets wrong, and why a second witness is needed.
 *
 * `assortedRho` fires on 8.3% of playlists whose own lecture titles are numbered
 * in order — MIT 18.03, Stanford CS224N, Professor Leonard's Calculus 3. They
 * are courses; what happened is that each lecture is famous enough to be found
 * from search on its own, so position stops predicting views. Measured against
 * 630 playlists whose titles number themselves, and 69 that are unmistakably
 * channel shelves, the shape of the thing is far better told by how it was
 * made than by how it is watched:
 *
 *                            shelves   numbered courses
 *   over 120 videos            79.7%              0.2%
 *   uploaded across 2+ years  100.0%              7.3%
 *   lecture lengths all over   50.7%              4.9%
 *   views unrelated to order   62.3%              8.9%   ← the old sole test
 *
 * So the curve still decides whether retention may be scored — that is a
 * question about the statistics — but the row says «Подборка» only when the way
 * the playlist was built agrees.
 */
export const COLLECTION = {
  /** More lectures than a course has. Only 1 of 630 numbered courses is this long. */
  videos: 120,
  /** Filmed across years rather than one term. */
  spanDays: 730,
  /** Lecture lengths scattered around their own median. */
  durationSpread: 0.45,
  /** Below this a playlist is too small to be a pile, whatever its curve says. */
  minVideos: 20,
} as const;

/** Shares of a playlist's titles that settle the question on their own. */
export const TITLE_ORDER = { numbered: 0.6, lectureWords: 0.7 } as const;

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

/* ─────────────────────  How the playlist was built  ─────────────────── */

/**
 * How the lectures themselves were made, as opposed to how they are watched.
 *
 * None of it comes from the API's playlist record — it is read off the videos:
 * their titles, their upload dates and their lengths. A course is a term's work
 * by one person and looks like it from every angle at once.
 */
export type Structure = {
  /** Titles carry their own position, or all say «lecture». */
  ordered: boolean;
  /** Days between the first upload and the last, or null under three dates. */
  spanDays: number | null;
  /** Scatter of lecture lengths around their median, or null under five. */
  durationSpread: number | null;
  /** Share of lectures nothing like the rest in length, or null under eight. */
  oddLengths: number | null;
  videoCount: number;
};

/** A number in the title equal to the video's own place in the playlist. */
const TITLE_NUMBER = /(?:^|[^\d])(\d{1,3})(?:[^\d]|$)/g;

/**
 * Words that mean «this is one instalment of something», in both catalogue
 * languages. Deliberately not «course» or «курс»: those name the whole, and a
 * shelf is quite happy to call itself one.
 */
const LECTURE_WORD =
  /(?:^|\W)(lecture|lec|lesson|part|chapter|episode|week|unit|module|seminar|лекция|лекции|занятие|урок|часть|семинар)(?:\W|$)/i;

/**
 * True when the titles themselves say what order to watch in.
 *
 * The numbering test matches a video's position, not merely the presence of a
 * digit — a shelf full of «Physics 101» does not pass, and a course whose files
 * are named after their chapter does. It is the one witness that never fires on
 * a shelf: of 69 unmistakable ones, not a single one numbers itself in order.
 */
export function titlesOrdered(titles: string[]): boolean {
  if (titles.length < 5) return false;
  let numbered = 0;
  let worded = 0;
  for (const [index, title] of titles.entries()) {
    const text = title ?? '';
    TITLE_NUMBER.lastIndex = 0;
    for (const match of text.matchAll(TITLE_NUMBER)) {
      if (Number(match[1]) === index + 1) {
        numbered++;
        break;
      }
    }
    if (LECTURE_WORD.test(text)) worded++;
  }
  return (
    numbered / titles.length >= TITLE_ORDER.numbered ||
    worded / titles.length >= TITLE_ORDER.lectureWords
  );
}

/** Days from the first upload to the last. Three dates before it means anything. */
export function uploadSpanDays(dates: Array<string | null | undefined>): number | null {
  const times = dates
    .map((date) => (date ? Date.parse(date) : NaN))
    .filter((time) => Number.isFinite(time));
  if (times.length < 3) return null;
  return (Math.max(...times) - Math.min(...times)) / 864e5;
}

/**
 * How unequal the lecture lengths are — MAD over the median.
 *
 * A term's lectures are all the same slot: 0.09 for a numbered course, 0.46 for
 * a shelf that mixes a three-minute answer with a ninety-minute lecture.
 */
export function durationSpreadOf(seconds: Array<number | null | undefined>): number | null {
  const lengths = seconds.filter((value): value is number => typeof value === 'number' && value > 0);
  if (lengths.length < 5) return null;
  const center = median(lengths);
  if (center <= 0) return null;
  return (median(lengths.map((value) => Math.abs(value - center))) * 1.4826) / center;
}

/**
 * How many of the lectures are nothing like the rest of them.
 *
 * Not the same question as `durationSpreadOf`, and the difference is the whole
 * point. That one is a MAD — deliberately robust, so a couple of outliers move
 * it barely at all. Станкевич's discrete maths is fourteen lectures of about
 * eighty-five minutes with an eight-minute one and a ten-minute one among them:
 * MAD says 0.15, which is «even», and the reader looking at the list says the
 * opposite. Robustness is right for deciding whether a playlist is a shelf and
 * wrong for warning that its lectures are not one thing.
 *
 * So this counts instead of averaging: what share of the lectures are more than
 * `ratio` away from the middle one, in either direction.
 */
export const ODD_LENGTHS = {
  /** Two and a half times the median, up or down, is not the same kind of thing. */
  ratio: 2.5,
  /** Under this many lectures one odd one out says nothing about the rest. */
  minVideos: 8,
} as const;

export function oddLengthShare(seconds: Array<number | null | undefined>): number | null {
  const lengths = seconds.filter((value): value is number => typeof value === 'number' && value > 0);
  if (lengths.length < ODD_LENGTHS.minVideos) return null;
  const center = median(lengths);
  if (center <= 0) return null;
  const odd = lengths.filter(
    (value) => value < center / ODD_LENGTHS.ratio || value > center * ODD_LENGTHS.ratio
  ).length;
  return odd / lengths.length;
}

/**
 * What a complete course looks like from the outside.
 *
 * The mirror image of `isCollection`, and it earns its place for the same
 * reason: of the playlists the numbers had nothing to say about, 17% are a
 * whole term of numbered lectures in equal slots — MIT 7.016, Половинкин's
 * ТФКП, Onur Mutlu's Computer Architecture. Showing a reader nothing about
 * those is a worse answer than showing them what the thing is.
 *
 * Deliberately says nothing about quality, which is why it is a type and not a
 * status: «this is a whole ordered course» stays true of a playlist the signals
 * are unkind to, and saying it costs the rating nothing.
 */
export const FULL_COURSE = {
  /**
   * A term's worth.
   *
   * It was 20, which is not a term but a year and a half of one: a Russian
   * semester is one lecture a week for thirteen to sixteen weeks, and 20
   * refused the word to 1039 playlists — a third of the catalogue — for being
   * exactly the length a course actually is.
   */
  videos: 12,
  /** Filmed to a timetable, not accumulated. */
  spanDays: 400,
  /** One term, and on its own evidence of a timetable. */
  oneTerm: 200,
  /** Every lecture the same slot. */
  durationSpread: 0.35,
  /**
   * And none of them a different kind of thing.
   *
   * «Equal slots» is the claim, so the odd ones out are counted rather than
   * averaged away: fourteen eighty-five-minute lectures with an eight-minute
   * one among them pass every test above and are not a term in equal slots.
   * The playlist keeps the truer word — «Разная длина» — instead.
   */
  oddLengths: 0.1,
} as const;

/**
 * A term of lectures, filmed to a timetable, in equal slots.
 *
 * The titles saying so is one way to know and not the only one: 964 playlists
 * — a third of the catalogue — number their lectures nowhere but in the
 * playlist order, which is where ИТМО, МГУ and half of МФТИ put it. Filming the
 * whole thing inside one term is the same evidence arriving by another road, so
 * either will do, and everything else still has to hold.
 */
export function isFullCourse(structure: Structure): boolean {
  if (structure.videoCount < FULL_COURSE.videos) return false;
  if (structure.spanDays === null || structure.spanDays > FULL_COURSE.spanDays) return false;
  if (structure.durationSpread === null || structure.durationSpread > FULL_COURSE.durationSpread) {
    return false;
  }
  if ((structure.oddLengths ?? 0) >= FULL_COURSE.oddLengths) return false;
  return structure.ordered || structure.spanDays <= FULL_COURSE.oneTerm;
}

/**
 * Whether to call the thing a shelf out loud.
 *
 * Two witnesses, and a veto. The curve must not say the views follow the order,
 * the structural marks must agree, and the titles must not be numbering
 * themselves — a playlist that says «Lecture 7» on its seventh video has
 * answered the question already, whatever its views do.
 *
 * The weaker the curve's evidence, the more structure has to carry: one mark
 * when the views plainly ignore the order, two when the curve came out
 * `unclear`. That second case is not a technicality — Khan Academy's «Algebra
 * I» is 421 videos put up across six and a half years, and its rho lands a
 * hair short of the line. Six and a half years of uploads is the better witness.
 */
export function isCollection(curve: Curve | null, structure: Structure): boolean {
  if (!curve || curve.kind === 'series') return false;
  if (structure.videoCount < COLLECTION.minVideos) return false;
  if (structure.ordered) return false;
  const marks =
    Number(structure.videoCount >= COLLECTION.videos) +
    Number((structure.spanDays ?? 0) >= COLLECTION.spanDays) +
    Number((structure.durationSpread ?? 0) >= COLLECTION.durationSpread);
  return marks >= (curve.kind === 'assorted' ? 1 : 2);
}

/**
 * Views per lecture against the size of the channel — how far past it it went.
 *
 * Raw views cannot answer that: they measure the size of the channel more than
 * anything about the playlist, and putting them in the rank brought back the
 * bias the whole rewrite exists to remove (a 0.30 rank correlation with views).
 * Divided by the channel, the same number says something a small channel can
 * also win.
 */
export function reachOf(
  views: number,
  videoCount: number,
  subscribers: number | null | undefined
): number | null {
  if (views <= 0 || videoCount <= 0 || !subscribers) return null;
  if (subscribers < MIN_REACH_SUBSCRIBERS) return null;
  return views / videoCount / subscribers ** REACH_EXPONENT;
}

/**
 * Views per lecture grow as the 0.68 power of subscribers across the catalogue,
 * not in step with them — a channel ten times the size gets five times the
 * views per lecture, not ten. Dividing by the count itself therefore
 * over-corrected, and reach came out at −0.23 against channel size: a metric
 * for «small channel» wearing the name of one for «travelled far». At 0.8 the
 * correlation is +0.005 and the number finally means what it says.
 *
 * 0.8 rather than the measured 0.68 because the fit is dominated by the large
 * channels, where most of the catalogue is; the gentler exponent leaves a
 * little of the advantage with the small ones rather than betting the badge on
 * a slope read off forty thin bins.
 */
export const REACH_EXPONENT = 0.8;

/**
 * Below this the ratio has no denominator worth dividing by.
 *
 * 53 channels in the catalogue have under a thousand subscribers and 94% of
 * them hold exactly one playlist: they are private accounts somebody used to
 * mirror a Stanford or MIT course. A nine-subscriber channel with 1.6M views on
 * Susskind's «Cosmology» topped the reach scale by a mile, and the fix is not
 * a gentler exponent — the shape of the thing is wrong. There is no channel
 * there for the playlist to have travelled past, so the question is unanswered
 * rather than answered spectacularly.
 */
export const MIN_REACH_SUBSCRIBERS = 1000;

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
 * The one word the list shows about the numbers.
 *
 * Deliberately all neutral or positive. The rating can honestly say "this one
 * is loved and finished"; it cannot say "this one is bad" — the same low like
 * rate is earned by NPTEL, whose audience simply does not press the button,
 * and by a genuinely dull recording, and nothing in the data separates them.
 * So a weak playlist gets no word at all and sinks in the sort, which is the
 * true statement.
 *
 * What the playlist *is* is not here. «Подборка» and «Полный курс» were words
 * on this same ladder, and being a ladder it let only one of them speak: a
 * shelf people plainly like was told it was a shelf and nothing else, which is
 * 440 playlists — 15% of the catalogue — whose rating was thrown away to
 * describe their shape. Shape is answered separately now, by `playlistTypeOf`,
 * and both facts fit on the row at once.
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
 *
 * Because the rungs overlap, a share here is not the share of the catalogue
 * that ends up wearing the word — several rungs claim the same playlist and
 * only one of them speaks. These six were solved for on the built catalogue to
 * land each word between 6.5% and 7.7% of it, and «Без статуса» at 35%. Every
 * cut they produce is still at least a fifth of a sigma above peers, so the
 * shares are chosen but the words are not cheap. Rerun the numbers when the
 * catalogue grows: `meta.json` records what each one cost this build.
 */
export const STATUS_TARGETS: Record<EarnedStatus, number> = {
  excellent: 0.59,
  classic: 0.43,
  retained: 0.39,
  liked: 0.31,
  discussed: 0.25,
  reaching: 0.22,
};

/**
 * What each rung asks for, beyond clearing its threshold.
 *
 * `uncontradicted` guards every single-signal word: praise for one number is
 * withdrawn when another one flatly disagrees.
 */
type Rung = {
  key: EarnedStatus;
  /** The number this rung is ranked by. Null means the rung does not apply. */
  metric: (input: StatusInput) => number | null;
  eligible: (input: StatusInput) => boolean;
};

/**
 * How far below its peers a signal has to be before it cancels the other one.
 *
 * A sigma. Half the catalogue sits within a third of one either way, so this
 * catches only a playlist the data is actually arguing about, not one that is
 * merely unremarkable.
 */
export const CONTRADICTION = -1;

/**
 * The two signals about the lectures themselves must not disagree with the word.
 *
 * This replaces a gate on the composite rating, which sounded like the same
 * idea and was not. Rating is the mean of approval and retention, so «rating
 * ≥ 0» refused every word to half the catalogue by construction: 803 playlists
 * — 28% of everything — cleared a threshold and were told nothing, and 531 of
 * those were «Разошёлся». That was not the gate working. It was the gate
 * papering over a reach metric that measured channel size (see
 * `MIN_REACH_SUBSCRIBERS`), and the paper covered a great deal besides.
 *
 * Only approval and retention count as contradiction. Reach and discussion are
 * circumstances — a channel's size, whether comments are on — and a playlist
 * being unremarkable on either says nothing against it being loved.
 */
const uncontradicted = (input: StatusInput): boolean =>
  (input.approvalZ ?? 0) >= CONTRADICTION && (input.retentionZ ?? 0) >= CONTRADICTION;

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
    // Old and still worth the time. Ranked by the rating rather than by reach:
    // reach needs a subscriber count, and 832 playlists in the catalogue were
    // found on GitHub course pages and carry no channel at all — ranking by it
    // withheld «Классика» from 29% of the catalogue over where we found it.
    metric: (input) => input.rating,
    eligible: (input) => uncontradicted(input) && (input.year ?? 9999) <= CLASSIC_YEAR,
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
  { key: 'retained', metric: (input) => input.retentionZ, eligible: uncontradicted },
  { key: 'liked', metric: (input) => input.approvalZ, eligible: uncontradicted },
  { key: 'discussed', metric: (input) => input.discussionZ, eligible: uncontradicted },
  { key: 'reaching', metric: (input) => input.reachZ, eligible: uncontradicted },
];

export const RUNGS: Rung[] = [...COMPOUND_RUNGS, ...SIGNAL_RUNGS];

/** Recorded this year or earlier, and still watched, is a classic. */
export const CLASSIC_YEAR = 2016;

/**
 * The one word, chosen in three steps.
 *
 * First the two gates, in order, because each outranks anything built on top of
 * it: that the numbers are not evidence beats any praise drawn from them, and
 * that a playlist is still being uploaded beats a verdict on figures still
 * moving.
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
