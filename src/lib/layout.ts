/**
 * Card geometry.
 *
 * Cards are laid out by the browser, not by coordinates from the build: the
 * screen is columns of equal-height cards, so `row` from `courses.json` and a
 * fixed card height are enough for the build's ordering to show up as rows that
 * line up across columns.
 */
export const CARD_WIDTH = 200;
export const CARD_HEIGHT = 180;

/**
 * The gap between columns. A number here rather than a `gap-6` in the markup
 * because the arrow-key step is a column plus this, and the two drifting apart
 * scrolls to somewhere that is not a column edge.
 */
export const COLUMN_GAP = 24;

/** Height of the artwork strip; the rest of the card is text. */
export const CARD_ART_HEIGHT = 60;
