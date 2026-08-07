/**
 * Card geometry.
 *
 * Cards are laid out by the browser, not by coordinates from the build: the
 * screen is columns of equal-height cards, so `row` from `courses.json` and a
 * fixed card height are enough for the build's ordering to show up as rows that
 * line up across columns.
 */
export const CARD_WIDTH = 180;
export const CARD_HEIGHT = 140;
