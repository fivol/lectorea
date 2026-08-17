import { describe, expect, it } from 'vitest';
import {
  approvalOf,
  audienceCurve,
  channelDeviations,
  CLASSIC_YEAR,
  curveKind,
  curveOf,
  discussionOf,
  engagementOf,
  durationSpreadOf,
  isCollection,
  isFullCourse,
  isReversed,
  MAX_PLAUSIBLE_APPROVAL,
  MIN_REACH_SUBSCRIBERS,
  median,
  peerKey,
  rateCatalogue,
  ratingOf,
  reachOf,
  robustZ,
  saturate,
  SINGLE_SIGNAL_TRUST,
  spreadOf,
  statusOf,
  thresholdsFor,
  titlesOrdered,
  uploadSpanDays,
  Z_LIMIT,
  type Rateable,
  type StatusInput,
} from '../scripts/lib/score.js';

const NOW = new Date('2026-08-13T00:00:00Z');

describe('raw signals', () => {
  it('reads approval as likes per view', () => {
    expect(approvalOf({ views: 1000, likes: 40 })).toBeCloseTo(0.04);
  });

  it('has no opinion when there is nothing to divide', () => {
    expect(approvalOf({ views: 0, likes: 5 })).toBeNull();
    expect(approvalOf({ views: 1000, likes: 0 })).toBeNull();
    expect(discussionOf({ views: 1000, comments: 0 })).toBeNull();
  });

  it('clips a like rate no audience could produce', () => {
    // 10 638 likes against 24 076 views — a real row in the catalogue.
    expect(approvalOf({ views: 24076, likes: 10638 })).toBe(MAX_PLAUSIBLE_APPROVAL);
  });

  it('keeps the old engagement column intact', () => {
    expect(engagementOf({ views: 1000, likes: 40, comments: 10 })).toBeCloseTo(0.05);
  });

  it('measures reach against the channel, not in absolute views', () => {
    const small = reachOf(40_000, 10, 20_000);
    const large = reachOf(400_000, 10, 4_000_000);
    expect(small).toBeGreaterThan(large!);
    expect(reachOf(1000, 10, null)).toBeNull();
  });

  it('does not turn reach into a prize for having a small channel', () => {
    // Views per lecture grow as the 0.68 power of subscribers across the
    // catalogue. Dividing by the count itself made reach −0.23 against channel
    // size: two channels on the real curve should now come out level.
    const modest = reachOf(20_000 * 10, 10, 20_000)!;
    const huge = reachOf(20_000 * 10 * 100 ** 0.68 * 10, 10, 20_000 * 100)!;
    expect(huge / modest).toBeGreaterThan(1);
    expect(huge / modest).toBeLessThan(12);
  });

  it('has no answer for a channel that is not one', () => {
    // 53 channels in the catalogue are private accounts holding one mirrored
    // course. Nine subscribers is not an audience the playlist travelled past.
    expect(reachOf(1_586_393, 8, MIN_REACH_SUBSCRIBERS - 1)).toBeNull();
    expect(reachOf(1_586_393, 8, MIN_REACH_SUBSCRIBERS)).not.toBeNull();
  });
});

describe('the view curve', () => {
  const decaying = [1000, 800, 640, 512, 410, 328, 262, 210, 168, 134, 107, 86];
  const scattered = [1000, 30, 5000, 12, 800, 40, 3000, 7, 1500, 90, 60, 2500];

  it('reads a course as a course', () => {
    const curve = curveOf(decaying)!;
    expect(curve.kind).toBe('series');
    expect(curve.retention).toBeLessThan(0.5);
    expect(curve.rho).toBeLessThan(-0.9);
  });

  it('reads a subject bucket as assorted', () => {
    expect(curveOf(scattered)!.kind).toBe('assorted');
  });

  it('says nothing at all under eight readable videos', () => {
    expect(curveOf([500, 400, 300, 200, 100])).toBeNull();
    expect(curveOf([500, null, undefined, 0, 400, 300, 200, 100])).toBeNull();
  });

  it('flips a playlist that runs newest first', () => {
    const forwards = curveOf(decaying, true)!;
    const backwards = curveOf(decaying, false)!;
    expect(forwards.retention).toBeLessThan(1);
    // Read the other way round the same curve grows, and the ceiling caps it.
    expect(backwards.retention).toBeGreaterThan(1);
    expect(backwards.reversed).toBe(true);
  });

  it('flips only on a clear majority of decreasing dates', () => {
    expect(isReversed(['2020-03-01', '2020-02-01', '2020-01-01'])).toBe(true);
    expect(isReversed(['2020-01-01', '2020-02-01', '2020-03-01'])).toBe(false);
    // Half in order is no order — position is still the watching order.
    expect(isReversed(['2020-01-01', '2020-03-01', '2020-02-01', '2020-04-01'])).toBe(false);
  });

  it('needs both a shape and a tight fit to call something a course', () => {
    expect(curveKind(-0.9, 0.3)).toBe('series');
    expect(curveKind(-0.9, 1.5)).toBe('assorted'); // decays, but wildly scattered
    expect(curveKind(0.1, 0.2)).toBe('assorted'); // tight, but unrelated to order
    expect(curveKind(-0.35, 0.9)).toBe('unclear');
  });

  // [game:audience] The same numbers kept per lecture — see `audienceCurve`.
  describe('the audience curve', () => {
    it('falls from a hundred and never climbs back', () => {
      const audience = audienceCurve(decaying, curveOf(decaying))!;
      expect(audience).toHaveLength(decaying.length);
      expect(audience[0]).toBe(100);
      expect(audience.at(-1)).toBeLessThan(20);
      for (let i = 1; i < audience.length; i++) {
        expect(audience[i]).toBeLessThanOrEqual(audience[i - 1]);
      }
    });

    it('holds the floor across a lecture whose views are missing', () => {
      const gapped = [...decaying];
      gapped[5] = null as unknown as number;
      const audience = audienceCurve(gapped, curveOf(gapped))!;
      expect(audience[5]).toBe(audience[4]);
      expect(audience[6]).toBeLessThan(audience[5]);
    });

    it('does not climb when one lecture in the middle went round on its own', () => {
      const spike = [...decaying];
      spike[7] = 900;
      const audience = audienceCurve(spike, curveOf(spike))!;
      expect(audience[7]).toBe(audience[6]);
    });

    it('says nothing where the ratio would not be about staying', () => {
      // A shelf entered from search: the number computes and means arrival.
      expect(audienceCurve(scattered, curveOf(scattered))).toBeUndefined();
      // And newest-first, where the crowd walked the list the other way.
      expect(audienceCurve(decaying, curveOf(decaying, false))).toBeUndefined();
      expect(audienceCurve(decaying, null)).toBeUndefined();
    });
  });
});

describe('how the playlist was built', () => {
  const numbered = Array.from({ length: 12 }, (_, index) => `Lecture ${index + 1}: topic`);
  const unnumbered = ['Photosynthesis', 'Mitosis', 'The cell wall', 'Enzymes', 'Osmosis', 'DNA'];

  it('reads an order off the titles when the titles state one', () => {
    expect(titlesOrdered(numbered)).toBe(true);
    expect(titlesOrdered(unnumbered)).toBe(false);
  });

  it('wants the number to be the video own place, not just any number', () => {
    // A shelf of «Physics 101» clips is not numbered, however many digits it has.
    expect(titlesOrdered(Array.from({ length: 10 }, () => 'Physics 101 problem'))).toBe(false);
  });

  it('takes «lecture» on every title as an order of its own', () => {
    expect(titlesOrdered(Array.from({ length: 10 }, (_, i) => `Лекция про ${i * 7}`))).toBe(true);
  });

  it('says nothing about a handful of titles', () => {
    expect(titlesOrdered(['Lecture 1', 'Lecture 2', 'Lecture 3'])).toBe(false);
  });

  it('measures the stretch the uploads cover', () => {
    expect(uploadSpanDays(['2020-01-01', '2020-01-11', '2020-01-21'])).toBe(20);
    expect(uploadSpanDays(['2020-01-01', '2020-01-11'])).toBeNull();
  });

  it('measures how unequal the lecture lengths are', () => {
    expect(durationSpreadOf([3000, 3000, 3000, 3000, 3000])).toBe(0);
    expect(durationSpreadOf([180, 3000, 400, 5400, 900, 240])!).toBeGreaterThan(0.5);
    expect(durationSpreadOf([3000, 3000])).toBeNull();
  });

  const shelfCurve = { retention: 1, rho: 0.1, scatter: 1.4, reversed: false, kind: 'assorted' } as const;
  const courseCurve = { retention: 0.4, rho: -0.8, scatter: 0.3, reversed: false, kind: 'series' } as const;
  const vagueCurve = { retention: 0.8, rho: -0.35, scatter: 0.9, reversed: false, kind: 'unclear' } as const;
  const shelf = { ordered: false, spanDays: 2400, durationSpread: 0.6, videoCount: 300 };

  it('needs the curve and the way it was built to agree before saying «shelf»', () => {
    expect(isCollection(shelfCurve, shelf)).toBe(true);
    // The curve alone used to decide, and called MIT 18.03 a shelf: a famous
    // course whose lectures are each found from search has exactly this curve.
    expect(isCollection(shelfCurve, { ...shelf, spanDays: 90, durationSpread: 0.1, videoCount: 30 })).toBe(
      false
    );
    // Titles that number themselves have already answered the question.
    expect(isCollection(shelfCurve, { ...shelf, ordered: true })).toBe(false);
    // And a curve that plainly follows the order is not overruled by structure.
    expect(isCollection(courseCurve, shelf)).toBe(false);
    expect(isCollection(null, shelf)).toBe(false);
  });

  it('asks more of the structure when the curve is unsure', () => {
    // One mark is enough behind an assorted curve, two behind an unclear one.
    const oneMark = { ordered: false, spanDays: 2400, durationSpread: 0.1, videoCount: 30 };
    expect(isCollection(shelfCurve, oneMark)).toBe(true);
    expect(isCollection(vagueCurve, oneMark)).toBe(false);
    expect(isCollection(vagueCurve, { ...oneMark, videoCount: 300 })).toBe(true);
  });

  it('will not call twenty-odd videos a shelf whatever their curve', () => {
    expect(isCollection(shelfCurve, { ...shelf, videoCount: 12 })).toBe(false);
  });

  it('recognises a whole term of lectures filmed to a timetable', () => {
    const term = {
      ordered: true,
      spanDays: 110,
      durationSpread: 0.08,
      oddLengths: 0,
      videoCount: 26,
    };
    expect(isFullCourse(term)).toBe(true);
    // Numbering is one way to know and not the only one: a third of the
    // catalogue numbers its lectures nowhere but in the playlist order, and
    // filming the whole thing inside one term says the same thing.
    expect(isFullCourse({ ...term, ordered: false })).toBe(true);
    expect(isFullCourse({ ...term, ordered: false, spanDays: 380 })).toBe(false);
    expect(isFullCourse({ ...term, videoCount: 9 })).toBe(false); // not a term
    expect(isFullCourse({ ...term, spanDays: 1800 })).toBe(false); // accumulated
    expect(isFullCourse({ ...term, durationSpread: 0.8 })).toBe(false); // uneven slots
    // Two lectures in fourteen that are nothing like the others: the lengths
    // average out even and the playlist is still not one thing.
    expect(isFullCourse({ ...term, oddLengths: 0.14 })).toBe(false);
    expect(isFullCourse({ ...term, spanDays: null })).toBe(false); // unknown, so unclaimed
  });

  it('never calls the same playlist both a shelf and a whole course', () => {
    const term = {
      ordered: true,
      spanDays: 110,
      durationSpread: 0.08,
      oddLengths: 0,
      videoCount: 26,
    };
    expect(isFullCourse(term) && isCollection(shelfCurve, term)).toBe(false);
  });
});

describe('normalisation', () => {
  it('groups peers by language and era', () => {
    expect(peerKey('en', 2011)).toBe('en|..2012');
    expect(peerKey('ru', 2023)).toBe('ru|2022..');
    expect(peerKey('ru', undefined)).toBe('ru|unknown');
  });

  it('takes the spread from quantiles, so one outlier cannot set the scale', () => {
    const sane = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const withOutlier = [...sane, 900];
    // A standard deviation would go from about 2.6 to about 284 on this row.
    expect(spreadOf(withOutlier).spread).toBeLessThan(spreadOf(sane).spread * 1.5);
    expect(spreadOf(withOutlier).center).toBeLessThan(6);
  });

  it('trusts a channel with many playlists more than one with two', () => {
    const many = channelDeviations(
      Array.from({ length: 40 }, () => ({ channelId: 'big', deviation: 1 }))
    );
    const few = channelDeviations([
      { channelId: 'small', deviation: 1 },
      { channelId: 'small', deviation: 1 },
    ]);
    expect(many.get('big')!).toBeGreaterThan(few.get('small')!);
    expect(few.get('small')!).toBeLessThan(1);
  });

  it('bends the tail in without losing the order', () => {
    expect(saturate(0.5)).toBeCloseTo(0.5, 1);
    expect(saturate(9)).toBeLessThan(Z_LIMIT);
    expect(saturate(9)).toBeGreaterThan(saturate(6));
    expect(saturate(-9)).toBeGreaterThan(-Z_LIMIT);
  });

  it('measures a z against the given centre and spread', () => {
    expect(robustZ(3, { center: 1, spread: 2 })).toBe(1);
  });
});

describe('the rating', () => {
  it('averages the signals it has', () => {
    expect(ratingOf({ approval: 1, retention: 0, reach: null })).toBeCloseTo(0.5);
  });

  it('discounts a rating resting on one signal', () => {
    expect(ratingOf({ approval: 2, retention: null, reach: null })).toBeCloseTo(
      2 * SINGLE_SIGNAL_TRUST
    );
  });

  it('is absent when nothing could be measured', () => {
    expect(ratingOf({ approval: null, retention: null, reach: null })).toBeNull();
  });
});

describe('status', () => {
  const base: StatusInput = {
    views: 100_000,
    videoCount: 20,
    year: 2020,
    lastVideoAt: '2020-06-01T00:00:00Z',
    rating: 1,
    approvalZ: 1,
    retentionZ: 1,
    discussionZ: 0,
    reachZ: 0,
  };
  const cuts = { excellent: 0.5, classic: 0.5, retained: 0.5, liked: 0.5, discussed: 0.5, reaching: 0.5 };

  it('says the data is thin before it says anything else', () => {
    expect(statusOf({ ...base, views: 500 }, cuts, NOW)).toBe('sparse');
    // 20 lectures sharing 2000 views is 100 apiece — a curve made of noise.
    expect(statusOf({ ...base, views: 2000 }, cuts, NOW)).toBe('sparse');
  });

  it('says a playlist is still settling before judging it', () => {
    expect(statusOf({ ...base, lastVideoAt: '2026-07-01T00:00:00Z' }, cuts, NOW)).toBe('fresh');
  });

  it('says nothing at all when nothing was earned', () => {
    // The shape of the playlist used to answer here — «Полный курс» — and
    // saying it in this slot cost the rating of everything it described.
    expect(statusOf({ ...base, rating: 0, approvalZ: 0, retentionZ: 0 }, cuts, NOW)).toBe('none');
  });

  it('reserves «excellent» for playlists neither signal contradicts', () => {
    expect(statusOf(base, cuts, NOW)).toBe('excellent');
    // Carried by retention alone, with approval below its peers: not excellent.
    const lopsided = { ...base, approvalZ: -1, retentionZ: 3, rating: 1 };
    expect(statusOf(lopsided, cuts, NOW)).toBe('retained');
  });

  it('picks the scale a playlist stands out most on', () => {
    // Below the «excellent» cut, so the single scales get to answer.
    const talkative = { ...base, approvalZ: 0.6, retentionZ: 0.6, discussionZ: 2.5, rating: 0.4 };
    expect(statusOf(talkative, cuts, NOW)).toBe('discussed');
  });

  it('withdraws a word when another signal flatly contradicts it', () => {
    const contradicted = { ...base, rating: -1, approvalZ: -2, retentionZ: -2, reachZ: 3 };
    expect(statusOf(contradicted, cuts, NOW)).toBe('none');
    // Merely unremarkable is not a contradiction: the old gate on the composite
    // rating refused a word to 28% of the catalogue on numbers like these.
    const quiet = { ...base, rating: -0.4, approvalZ: -0.5, retentionZ: -0.3, reachZ: 3 };
    expect(statusOf(quiet, cuts, NOW)).toBe('reaching');
  });

  it('calls an old playlist that still holds up a classic', () => {
    // Approval a shade under its peers, so «excellent» is out of reach and the
    // rung being tested is the one that answers.
    const old = { ...base, year: CLASSIC_YEAR - 2, retentionZ: 0.1, approvalZ: -0.2, rating: 0.6, reachZ: 2 };
    expect(statusOf(old, cuts, NOW)).toBe('classic');
    // Ranked by the rating, not by reach: 832 playlists in the catalogue have
    // no channel behind them and would be refused the word over that alone.
    const noChannel = { ...old, reachZ: null };
    expect(statusOf(noChannel, cuts, NOW)).toBe('classic');
  });

  it('hands each rung a share of its own candidates', () => {
    const inputs: StatusInput[] = Array.from({ length: 100 }, (_, index) => ({
      ...base,
      // Spread across the scale so the quantiles have something to cut.
      rating: index / 100,
      approvalZ: index / 100,
      retentionZ: index / 100,
      discussionZ: index / 100,
      reachZ: index / 100,
    }));
    const cut = thresholdsFor(inputs, NOW);
    const excellent = inputs.filter((input) => statusOf(input, cut, NOW) === 'excellent');
    // The target is 0.6 of the candidates; every one of these is a candidate.
    expect(excellent.length).toBeGreaterThan(50);
    expect(excellent.length).toBeLessThan(70);
  });
});

describe('the catalogue as a whole', () => {
  const playlist = (over: Partial<Rateable> & { id: string }): Rateable => ({
    channelId: 'c1',
    lang: 'ru',
    year: 2020,
    videoCount: 20,
    stats: { views: 100_000, likes: 1500, comments: 100 },
    lastVideoAt: '2020-06-01T00:00:00Z',
    ...over,
  });

  it('rates every playlist and never leaves one without a status', () => {
    // The two signals must not move together, or nothing can be good at both.
    const items = Array.from({ length: 60 }, (_, index) =>
      playlist({
        id: `p${index}`,
        channelId: `c${index % 6}`,
        stats: {
          views: 40_000 + ((index * 37) % 60) * 5000,
          likes: 300 + ((index * 23) % 60) * 40,
          comments: 20 + ((index * 11) % 60) * 3,
        },
        retention: 0.2 + ((index * 17) % 60) * 0.02,
        curve: index % 7 === 0 ? 'assorted' : 'series',
        collection: index % 7 === 0,
      })
    );
    const { byId, thresholds } = rateCatalogue(items, () => 50_000, NOW);
    expect(byId.size).toBe(items.length);
    for (const item of items) {
      const rated = byId.get(item.id)!;
      expect(Number.isFinite(rated.rating)).toBe(true);
      expect(rated.status).toBeTruthy();
    }
    expect(Number.isFinite(thresholds.excellent)).toBe(true);
  });

  it('scores no shelf on retention, and still lets one be liked', () => {
    const items = Array.from({ length: 30 }, (_, index) =>
      playlist({
        id: `p${index}`,
        retention: 0.5,
        curve: index < 10 ? 'assorted' : 'series',
        collection: index < 10,
      })
    );
    const { byId } = rateCatalogue(items, () => 50_000, NOW);
    for (let index = 0; index < 10; index++) {
      // The curve is unreadable, so retention is not scored — but approval is,
      // and whatever it earns is now said out loud instead of being replaced by
      // a word about the playlist's shape.
      expect(byId.get(`p${index}`)!.signals.retention).toBeNull();
      expect(byId.get(`p${index}`)!.signals.approval).not.toBeNull();
    }
    expect(byId.get('p20')!.signals.retention).not.toBeNull();
  });

  it('does not let a whole channel be scored on its own habits', () => {
    // One generous channel, one stingy one, identical playlists within each.
    const items = [
      ...Array.from({ length: 10 }, (_, index) =>
        playlist({ id: `warm${index}`, channelId: 'warm', stats: { views: 100_000, likes: 4000, comments: 100 } })
      ),
      ...Array.from({ length: 10 }, (_, index) =>
        playlist({ id: `cold${index}`, channelId: 'cold', stats: { views: 100_000, likes: 500, comments: 100 } })
      ),
    ];
    const { byId } = rateCatalogue(items, () => 50_000, NOW);
    const warm = byId.get('warm0')!.signals.approval!;
    const cold = byId.get('cold0')!.signals.approval!;
    // The generous channel keeps its lead — the pull is partial, not a levelling.
    expect(warm).toBeGreaterThan(cold);
  });

  it('survives a catalogue with no statistics at all', () => {
    const items = Array.from({ length: 5 }, (_, index) =>
      playlist({ id: `p${index}`, stats: { views: 0, likes: 0, comments: 0 } })
    );
    const { byId } = rateCatalogue(items, () => null, NOW);
    for (const item of items) expect(byId.get(item.id)!.status).toBe('sparse');
  });
});

describe('median', () => {
  it('averages the middle pair on an even count', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});
