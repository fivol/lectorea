import { create } from 'zustand';
import { useIsMobile } from '@/lib/hooks';

/**
 * Transient view state. Anything that belongs in a shared link — selected
 * course, domain filter, provider filter, open playlist — lives in the URL
 * instead, so the browser back button and copy-paste both work.
 *
 * There is no pan or zoom state: the columns are ordinary scrollable layout, so
 * the browser owns the scroll position and keyboard scrolling works for free.
 */

export type MapView = 'map' | 'blocks';

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
  echoCourseId: string | null;
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

  setEcho: (id: string | null) => void;
  openProfile: () => void;
  closeProfile: () => void;
  requestFocus: (courseId: string) => void;
  setMapView: (next: MapView) => void;
};

export const useUi = create<UiStore>((set, get) => ({
  echoCourseId: null,
  profileOpen: false,
  focusRequest: null,
  mapView: 'map',

  setEcho: (id) => set({ echoCourseId: id }),
  openProfile: () => set({ profileOpen: true }),
  closeProfile: () => set({ profileOpen: false }),
  requestFocus: (courseId) =>
    set({ focusRequest: { courseId, nonce: (get().focusRequest?.nonce ?? 0) + 1 } }),
  setMapView: (next) => set({ mapView: next }),
}));

/**
 * The view actually on screen. A phone has no room for the drawing, so it
 * always gets the blocks — and the way back from the columns has to name the
 * view it returns to, not the one that was picked on a wider screen.
 */
export function useMapView(): MapView {
  const mapView = useUi((state) => state.mapView);
  return useIsMobile() ? 'blocks' : mapView;
}
