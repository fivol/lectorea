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

/**
 * The same gap when the chain is drawn as steps rather than as curves.
 *
 * A stepped line runs down a lane inside the gap, and several lines arriving at
 * one column want lanes side by side. At 24px there is no room for that: every
 * descent happens in the same few pixels, the line stops reading as a
 * connection and starts reading as a rail bolted to the side of the cards, and
 * two of them in one gap are one line. A curve needs no corridor, so it does
 * not pay for one.
 */
export const COLUMN_GAP_STEPPED = 48;

/** Height of the artwork strip; the rest of the card is text. */
export const CARD_ART_HEIGHT = 60;
