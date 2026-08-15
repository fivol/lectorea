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
 * The gap between columns — and the corridor the chain's curves are routed
 * down, which is why it is a number here rather than a `gap-6` in the markup.
 *
 * At 24px it was too narrow to route anything. A curve between adjacent columns
 * has its control points pulled by the horizontal distance, so the whole of a
 * four-hundred-pixel drop had to happen inside a twenty-four-pixel corridor: the
 * line stopped reading as a connection and started reading as a rail bolted to
 * the side of the cards, and two of them in one gap lay on top of each other.
 * Wide enough for a few lanes side by side is the whole requirement.
 */
export const COLUMN_GAP = 48;

/** Height of the artwork strip; the rest of the card is text. */
export const CARD_ART_HEIGHT = 60;
