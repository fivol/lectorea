import { SCORE_CONFIDENCE_VIEWS } from '../../shared/schema.js';

/**
 * Rating of a playlist.
 *
 * Dislikes have been private since 2021, so there is no public "percent liked"
 * left. The only available proxy for quality is engagement — but raw engagement
 * is useless for sorting: a playlist with 40 views and one enthusiastic comment
 * would outrank an MIT course. Hence bayesian smoothing towards the catalogue
 * average, with `m` acting as the confidence threshold in views.
 *
 *   score = (v / (v + m)) * R + (m / (v + m)) * C
 */

export type Engagement = { views: number; likes: number; comments: number };

export function engagementOf({ views, likes, comments }: Engagement): number {
  if (views <= 0) return 0;
  return (likes + comments) / views;
}

/** Catalogue-wide mean engagement — the `C` the smoothing pulls towards. */
export function meanEngagement(items: Engagement[]): number {
  const usable = items.filter((i) => i.views > 0);
  if (!usable.length) return 0;
  const total = usable.reduce((sum, i) => sum + engagementOf(i), 0);
  return total / usable.length;
}

export function bayesianScore(
  item: Engagement,
  catalogueMean: number,
  confidenceViews: number = SCORE_CONFIDENCE_VIEWS
): number {
  const v = Math.max(0, item.views);
  const m = confidenceViews;
  if (v + m === 0) return 0;
  const r = engagementOf(item);
  return (v / (v + m)) * r + (m / (v + m)) * catalogueMean;
}

/**
 * Maps a raw score onto 0..100 for the quality dot in the list. Scores cluster
 * tightly around the mean, so a linear map would paint every dot the same
 * colour; the ratio to the mean is what actually separates them.
 */
export function scoreToPercent(score: number, catalogueMean: number): number {
  if (catalogueMean <= 0) return 50;
  const ratio = score / catalogueMean;
  // ratio 0.5 → 25, 1 → 50, 2 → 75, 4 → 100
  const mapped = 50 + 25 * Math.log2(ratio);
  return Math.round(Math.min(100, Math.max(0, mapped)));
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
