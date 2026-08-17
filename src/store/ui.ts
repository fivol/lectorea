import { create } from 'zustand';

/**
 * Transient view state. Anything that belongs in a shared link — selected
 * course, domain filter, provider filter, open playlist — lives in the URL
 * instead, so the browser back button and copy-paste both work.
 *
 * There is no pan or zoom state: the columns are ordinary scrollable layout, so
 * the browser owns the scroll position and keyboard scrolling works for free.
 */

export type MapView = 'map' | 'blocks';

/**
 * A course the panel is pointing at, and the course it was named from.
 *
 * Both ends, because a name in the panel is one end of a relation and the panel
 * it stands in is the other: the columns can then borrow the card in, lift it
 * *and* draw the edge between the two. `from` is null where there is no edge to
 * draw — a step of the path is already joined to everything it belongs to.
 */
export type Echo = { id: string; from: string | null };

export type UiStore = {
  /**
   * Set by the panel and the path list on hover, to lift the matching card in
   * the columns.
   *
   * There is no companion for the columns' own hover any more: pointing at a
   * card used to repaint the whole screen around it, and what it answered —
   * "what does this one need" — is the question a click already answers, in a
   * reading that then holds still.
   */
  echo: Echo | null;
  profileOpen: boolean;
  /** Bumped when a course should be scrolled into view. */
  focusRequest: { courseId: string; nonce: number } | null;
  /**
   * Map or blocks — for this visit only.
   *
   * Not in the profile: the map is the front door and every visit opens on it,
   * so a choice made once should not silently decide what the next visit looks
   * like. Not in the URL either: a link points at a territory or a course, not
   * at how the front page was drawn. Holding it here for the length of the
   * visit is what lets the way back from the columns land where it was left.
   */
  mapView: MapView;
  /**
   * How many layers are up that the keyboard belongs to — in practice, whether
   * a lecture is playing.
   *
   * The app's single-letter shortcuts are safe on a page being read and not on
   * one being watched: `m` swaps map and columns, which closes the player and
   * loses the lecture, and it is one key away from `k` and `l`, which the
   * player answers. A layer that owns the keyboard says so, and they stand
   * down for as long as it is up. A count rather than a flag, because two of
   * them can overlap and the second one closing must not speak for the first.
   */
  keyboardHeld: number;
  /**
   * Whether «Ваше обучение» has been put away — for this visit only.
   *
   * Here rather than in the profile on purpose. The card is a reader's own
   * study staring back at them, and there are days when that is the last thing
   * somebody wants on the front page; but a dismissal written to disk is a
   * setting nobody remembers making, and the card would then be gone for good
   * with no way back that is any easier to find than the profile panel it
   * points at. A reload brings it back, which is what «разово» means.
   */
  summaryHidden: boolean;

  /** `from` is the panel the name was read in — the other end of the edge. */
  setEcho: (id: string | null, from?: string | null) => void;
  hideSummary: () => void;
  /** Claim the keyboard for a layer; the returned function gives it back. */
  holdKeyboard: () => () => void;
  openProfile: () => void;
  closeProfile: () => void;
  requestFocus: (courseId: string) => void;
  setMapView: (next: MapView) => void;
};

export const useUi = create<UiStore>((set, get) => ({
  echo: null,
  profileOpen: false,
  focusRequest: null,
  mapView: 'map',
  keyboardHeld: 0,
  summaryHidden: false,

  setEcho: (id, from = null) => set({ echo: id ? { id, from } : null }),
  hideSummary: () => set({ summaryHidden: true }),
  holdKeyboard: () => {
    set({ keyboardHeld: get().keyboardHeld + 1 });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      set({ keyboardHeld: Math.max(0, get().keyboardHeld - 1) });
    };
  },
  openProfile: () => set({ profileOpen: true }),
  closeProfile: () => set({ profileOpen: false }),
  requestFocus: (courseId) =>
    set({ focusRequest: { courseId, nonce: (get().focusRequest?.nonce ?? 0) + 1 } }),
  setMapView: (next) => set({ mapView: next }),
}));

/**
 * The view on screen.
 *
 * A phone used to be sent to the blocks whatever it asked for, because the one
 * drawing there was is a wide one and a wide drawing on a tall screen is a
 * strip of land in a lot of water. There are two drawings now — see
 * `MapVariant` — so the choice belongs to the reader on every screen, and the
 * way back from the columns lands where it was left.
 */
export function useMapView(): MapView {
  return useUi((state) => state.mapView);
}
