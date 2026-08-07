import { create } from 'zustand';

/**
 * Transient view state for the courses screen. Anything that belongs in a shared
 * link — selected course, domain filter, provider filter, open playlist — lives
 * in the URL instead, so the browser back button and copy-paste both work.
 *
 * There is no pan or zoom state: the columns are ordinary scrollable layout, so
 * the browser owns the scroll position and keyboard scrolling works for free.
 */

export type UiStore = {
  hoveredCourseId: string | null;
  /** Set by the path list on hover, to light up the matching card in the columns. */
  echoCourseId: string | null;
  profileOpen: boolean;
  /** Bumped when a course should be scrolled into view. */
  focusRequest: { courseId: string; nonce: number } | null;

  setHovered: (id: string | null) => void;
  setEcho: (id: string | null) => void;
  openProfile: () => void;
  closeProfile: () => void;
  requestFocus: (courseId: string) => void;
};

export const useUi = create<UiStore>((set, get) => ({
  hoveredCourseId: null,
  echoCourseId: null,
  profileOpen: false,
  focusRequest: null,

  setHovered: (id) => set({ hoveredCourseId: id }),
  setEcho: (id) => set({ echoCourseId: id }),
  openProfile: () => set({ profileOpen: true }),
  closeProfile: () => set({ profileOpen: false }),
  requestFocus: (courseId) =>
    set({ focusRequest: { courseId, nonce: (get().focusRequest?.nonce ?? 0) + 1 } }),
}));
