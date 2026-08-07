import { create } from 'zustand';

/**
 * Transient view state for the graph screen. Anything that belongs in a shared
 * link — selected course, domain filter, provider filter, open playlist — lives
 * in the URL instead, so the browser back button and copy-paste both work.
 */

export const ZOOM_STEPS = [0.45, 1, 1.6] as const;
export type ZoomIndex = 0 | 1 | 2;

export type UiStore = {
  hoveredCourseId: string | null;
  /** Set by the path list on hover, to light up the matching card in the graph. */
  echoCourseId: string | null;
  zoomIndex: ZoomIndex;
  pan: { x: number; y: number };
  profileOpen: boolean;
  /** Bumped when the graph should scroll a course into view. */
  focusRequest: { courseId: string; nonce: number } | null;

  setHovered: (id: string | null) => void;
  setEcho: (id: string | null) => void;
  setZoom: (index: ZoomIndex) => void;
  zoomBy: (delta: number) => void;
  setPan: (pan: { x: number; y: number }) => void;
  panBy: (dx: number, dy: number) => void;
  openProfile: () => void;
  closeProfile: () => void;
  requestFocus: (courseId: string) => void;
};

export const useUi = create<UiStore>((set, get) => ({
  hoveredCourseId: null,
  echoCourseId: null,
  zoomIndex: 1,
  pan: { x: 0, y: 0 },
  profileOpen: false,
  focusRequest: null,

  setHovered: (id) => set({ hoveredCourseId: id }),
  setEcho: (id) => set({ echoCourseId: id }),
  setZoom: (index) => set({ zoomIndex: index }),
  zoomBy: (delta) => {
    const next = Math.min(2, Math.max(0, get().zoomIndex + delta)) as ZoomIndex;
    if (next !== get().zoomIndex) set({ zoomIndex: next });
  },
  setPan: (pan) => set({ pan }),
  panBy: (dx, dy) => {
    const { pan } = get();
    set({ pan: { x: pan.x + dx, y: pan.y + dy } });
  },
  openProfile: () => set({ profileOpen: true }),
  closeProfile: () => set({ profileOpen: false }),
  requestFocus: (courseId) =>
    set({ focusRequest: { courseId, nonce: (get().focusRequest?.nonce ?? 0) + 1 } }),
}));
