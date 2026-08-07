/**
 * Card geometry. Must stay in sync with `scripts/lib/layout.ts`, which produced
 * the coordinates stored in courses.json — the client never recomputes them.
 */
export const CARD_WIDTH = 180;
export const CARD_HEIGHT = 140;
export const COLUMN_GAP = 110;
export const ROW_GAP = 28;

export type Rect = { x: number; y: number; width: number; height: number };

export function cardRect(course: { x: number; y: number }): Rect {
  return { x: course.x, y: course.y, width: CARD_WIDTH, height: CARD_HEIGHT };
}

export function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/** Edge from the right edge of one card to the left edge of the next. */
export function edgePath(
  from: { x: number; y: number },
  to: { x: number; y: number }
): string {
  const x1 = from.x + CARD_WIDTH;
  const y1 = from.y + CARD_HEIGHT / 2;
  const x2 = to.x;
  const y2 = to.y + CARD_HEIGHT / 2;
  const dx = Math.max(40, (x2 - x1) * 0.5);
  return `M${x1} ${y1}C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`;
}

/** Thin two-way line for `related`, drawn between card centres. */
export function relatedPath(
  from: { x: number; y: number },
  to: { x: number; y: number }
): string {
  const x1 = from.x + CARD_WIDTH / 2;
  const y1 = from.y + CARD_HEIGHT / 2;
  const x2 = to.x + CARD_WIDTH / 2;
  const y2 = to.y + CARD_HEIGHT / 2;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2 - Math.abs(x2 - x1) * 0.12;
  return `M${x1} ${y1}Q${mx} ${my} ${x2} ${y2}`;
}
