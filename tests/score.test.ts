import { describe, expect, it } from 'vitest';
import {
  approvalOf,
  channelDeviations,
  CLASSIC_YEAR,
  curveKind,
  curveOf,
  discussionOf,
  engagementOf,
  isReversed,
  MAX_PLAUSIBLE_APPROVAL,
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
    curve: 'series',
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

  it('names the shape before praising a bucket for being liked', () => {
    expect(statusOf({ ...base, curve: 'assorted', approvalZ: 3 }, cuts, NOW)).toBe('assorted');
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

  it('never praises a playlist its rating calls below average', () => {
    const contradicted = { ...base, rating: -1, approvalZ: -2, retentionZ: -2, reachZ: 3 };
    expect(statusOf(contradicted, cuts, NOW)).toBe('none');
  });

  it('calls an old playlist people still find a classic', () => {
    const old = { ...base, year: CLASSIC_YEAR - 2, retentionZ: 0.1, approvalZ: 0.1, rating: 0.1, reachZ: 2 };
    expect(statusOf(old, cuts, NOW)).toBe('classic');
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

  it('marks every assorted playlist as such and scores none of them on retention', () => {
    const items = Array.from({ length: 30 }, (_, index) =>
      playlist({
        id: `p${index}`,
        retention: 0.5,
        curve: index < 10 ? 'assorted' : 'series',
      })
    );
    const { byId } = rateCatalogue(items, () => 50_000, NOW);
    for (let index = 0; index < 10; index++) {
      expect(byId.get(`p${index}`)!.status).toBe('assorted');
      expect(byId.get(`p${index}`)!.signals.retention).toBeNull();
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
