import { useNavigate } from 'react-router-dom';
import { courseHref, useCourseSlice } from '@/lib/url';
import { useUi } from '@/store/ui';

/**
 * The three ways off the desk.
 *
 * Courses are opened into their own fields rather than onto the whole
 * catalogue: «продолжить путь» that lands on a hundred and eighty unrelated
 * cards has answered a different question.
 *
 * Each one also closes the settings drawer, which is not redundant now that
 * the desk is a page: the drawer opens over it — the account, the file — and a
 * layer left standing over the course it just navigated to would hide the
 * answer behind the question.
 */
export function useProfileNavigation(): {
  openCourse: (courseId: string) => void;
  openPlaylist: (courseId: string, playlistId: string) => void;
  toMap: () => void;
} {
  const navigate = useNavigate();
  const closeProfile = useUi((state) => state.closeProfile);
  const requestFocus = useUi((state) => state.requestFocus);
  const sliceAround = useCourseSlice();

  return {
    openCourse: (courseId) => {
      closeProfile();
      navigate(courseHref(courseId, sliceAround(courseId)));
      requestFocus(courseId);
    },
    openPlaylist: (courseId, playlistId) => {
      closeProfile();
      const query = new URLSearchParams(sliceAround(courseId));
      query.set('playlist', playlistId);
      navigate(courseHref(courseId, `?${query.toString()}`));
    },
    toMap: () => {
      closeProfile();
      navigate('/');
    },
  };
}
