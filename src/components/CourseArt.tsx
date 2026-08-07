import { useMemo } from 'react';
import { courseArt, DEFAULT_VISUAL, ART_HEIGHT, ART_WIDTH } from '@shared/procedural';

type Props = {
  courseId: string;
  color: string;
  className?: string;
  /** Rounded corners on the top only, for cards where the art sits at the top. */
  rounded?: boolean;
};

/**
 * The generated picture for a course card.
 *
 * Rendered inline rather than as an <img src="…svg">: the graph shows hundreds
 * of cards at once, and the same deterministic generator that writes files in
 * `07-images.ts` produces identical markup here for free.
 */
export default function CourseArt({ courseId, color, className = '', rounded }: Props) {
  const art = useMemo(() => courseArt(courseId, color, DEFAULT_VISUAL), [courseId, color]);

  return (
    <svg
      viewBox={art.viewBox}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid slice"
      className={`${className} ${rounded ? 'rounded-t-lg' : ''}`}
      style={{ aspectRatio: `${ART_WIDTH} / ${ART_HEIGHT}` }}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: art.inner }}
    />
  );
}
