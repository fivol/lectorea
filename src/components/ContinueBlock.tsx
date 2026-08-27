import { useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { useResumeProgress, type ResumePointer } from '@/lib/progress';
import { courseHref, useCourseSlice } from '@/lib/url';
import { ResumeCard } from './ResumeCard';

/**
 * «Продолжить», wherever it is asked for.
 *
 * There are three places in the product that offer the recording somebody
 * stopped in — the plate in the corner of the map, the bar at the foot of a
 * narrow window, and the desk at `/learn` — and they must be the same press
 * doing the same thing. The offer and the navigation live here so that none of
 * them can drift: a card that opened the course while the desk opened the
 * recording would be two products wearing one word.
 */
export function ContinueOffer({
  resume,
  className = '',
}: {
  resume: ResumePointer;
  className?: string;
}) {
  const { t } = useT();
  const catalog = useCatalog();
  const openResume = useOpenResume();
  const progress = useResumeProgress(resume);
  const course = catalog.courseById.get(resume.entry.courseId);

  return (
    <ResumeCard
      videoId={resume.lastVideoId}
      title={resume.entry.title}
      subtitle={course ? t(`course.${course.id}.title`) : resume.entry.courseId}
      progress={progress}
      onClick={() => openResume(resume)}
      className={className}
    />
  );
}

/** Back into the playlist that was open, with its own field behind it. */
export function useOpenResume(): (resume: ResumePointer) => void {
  const navigate = useNavigate();
  const sliceAround = useCourseSlice();

  return (resume) => {
    const query = new URLSearchParams(sliceAround(resume.entry.courseId));
    query.set('playlist', resume.entry.id);
    navigate(courseHref(resume.entry.courseId, `?${query.toString()}`));
  };
}
