import { describe, expect, it } from 'vitest';
import { watchedBetween } from '@/lib/youtube';

/**
 * The one arithmetic on the app's side of the line that the whole progress
 * side of the product rests on: what a stretch of playing is worth.
 *
 * It is here rather than in a comment because the rule is easy to state, easy
 * to agree with and easy to break by tightening the ceiling — and if it breaks,
 * nothing fails. The hours simply come out smaller, on a screen nobody can
 * check against a stopwatch.
 */
describe('watchedBetween', () => {
  it('credits the lecture, not the evening — a stretch at 1× is itself', () => {
    expect(watchedBetween(5, 5, 1)).toBe(5);
  });

  it('credits an hour watched at 2× as an hour of the recording', () => {
    // Five seconds of the reader's evening, ten seconds of the lecture.
    expect(watchedBetween(10, 5, 2)).toBe(10);
    // The same fact at the scale it is printed at: half an evening, a whole hour.
    expect(watchedBetween(3600, 1800, 2)).toBe(3600);
  });

  it('credits a slow watch with the lecture time, which is less than the evening', () => {
    expect(watchedBetween(2.5, 5, 0.5)).toBe(2.5);
  });

  it('cuts a seek back to what could have been played', () => {
    // An hour of tape crossed in five seconds by dragging the playhead.
    expect(watchedBetween(3600, 5, 1)).toBe(5);
    expect(watchedBetween(3600, 5, 2)).toBe(10);
  });

  it('is never negative — a seek backwards is worth nothing, not a debt', () => {
    expect(watchedBetween(-600, 5, 1)).toBe(0);
  });

  it('pays nothing for a pause, however long it lasts', () => {
    expect(watchedBetween(0, 900, 1)).toBe(0);
  });
});
