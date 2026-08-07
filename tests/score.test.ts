import { describe, expect, it } from 'vitest';
import {
  bayesianScore,
  engagementOf,
  meanEngagement,
  median,
  scoreToPercent,
} from '../scripts/lib/score';
import { lectureLengthOf } from '../shared/schema';

describe('engagement', () => {
  it('is likes plus comments over views', () => {
    expect(engagementOf({ views: 1000, likes: 40, comments: 10 })).toBeCloseTo(0.05);
  });

  it('is zero rather than Infinity when nothing has been viewed', () => {
    expect(engagementOf({ views: 0, likes: 5, comments: 1 })).toBe(0);
  });
});

describe('bayesian score', () => {
  const mean = 0.03;

  it('pulls a tiny sample almost all the way to the catalogue mean', () => {
    // 40 views and one enthusiastic comment must not outrank an MIT course.
    const tiny = bayesianScore({ views: 40, likes: 1, comments: 1 }, mean);
    expect(tiny).toBeGreaterThan(mean * 0.95);
    expect(tiny).toBeLessThan(mean * 1.1);
  });

  it('lets a large sample speak for itself', () => {
    const large = bayesianScore({ views: 2_000_000, likes: 200_000, comments: 20_000 }, mean);
    expect(large).toBeGreaterThan(0.1);
  });

  it('ranks a well-liked popular playlist above a well-liked obscure one', () => {
    const popular = bayesianScore({ views: 500_000, likes: 50_000, comments: 5000 }, mean);
    const obscure = bayesianScore({ views: 100, likes: 10, comments: 1 }, mean);
    expect(popular).toBeGreaterThan(obscure);
  });

  it('is monotone in views for identical engagement', () => {
    const low = bayesianScore({ views: 10_000, likes: 1000, comments: 100 }, mean);
    const high = bayesianScore({ views: 100_000, likes: 10_000, comments: 1000 }, mean);
    expect(high).toBeGreaterThan(low);
  });

  it('respects a custom confidence threshold', () => {
    const item = { views: 5000, likes: 500, comments: 50 };
    const trusting = bayesianScore(item, mean, 100);
    const sceptical = bayesianScore(item, mean, 100_000);
    expect(trusting).toBeGreaterThan(sceptical);
  });
});

describe('catalogue mean', () => {
  it('ignores playlists with no views at all', () => {
    const value = meanEngagement([
      { views: 100, likes: 10, comments: 0 },
      { views: 0, likes: 0, comments: 0 },
    ]);
    expect(value).toBeCloseTo(0.1);
  });

  it('is zero for an empty catalogue', () => {
    expect(meanEngagement([])).toBe(0);
  });
});

describe('score to percent', () => {
  it('puts the catalogue mean in the middle', () => {
    expect(scoreToPercent(0.03, 0.03)).toBe(50);
  });

  it('doubles to 75 and halves to 25', () => {
    expect(scoreToPercent(0.06, 0.03)).toBe(75);
    expect(scoreToPercent(0.015, 0.03)).toBe(25);
  });

  it('stays inside 0..100', () => {
    expect(scoreToPercent(100, 0.03)).toBe(100);
    expect(scoreToPercent(0.0000001, 0.03)).toBe(0);
  });
});

describe('median', () => {
  it('averages the middle pair for an even count', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('takes the middle value for an odd count', () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it('is zero for nothing', () => {
    expect(median([])).toBe(0);
  });
});

describe('lecture length buckets', () => {
  it('maps the SPEC boundaries', () => {
    expect(lectureLengthOf(30 * 60)).toBe('lesson');
    expect(lectureLengthOf(40 * 60)).toBe('lesson'); // inclusive upper bound
    expect(lectureLengthOf(90 * 60)).toBe('pair');
    expect(lectureLengthOf(150 * 60)).toBe('double');
    expect(lectureLengthOf(240 * 60)).toBe('long');
  });
});
