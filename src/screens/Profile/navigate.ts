import { useNavigate } from 'react-router-dom';
import { courseHref, useCourseSlice } from '@/lib/url';
import { useUi } from '@/store/ui';

/**
 * The three ways out of the profile.
 *
 * Every one of them closes the panel first — the profile is a layer over a
 * screen, and leaving it standing over the thing it just navigated to would
 * hide the answer behind the question. Courses are opened into their own
 * fields rather than onto the whole catalogue: the panel is opened over either
 * screen, and «продолжить путь» that lands on a hundred and eighty unrelated
 * cards has answered a different question.
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
