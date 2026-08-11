import { useMemo } from 'react';
import { courseArt, DEFAULT_VISUAL, ART_HEIGHT, ART_WIDTH } from '@shared/procedural';
import type { Continent } from '@shared/schema';
import { useResolvedTheme } from '@/store/profile';

type Props = {
  courseId: string;
  color: string;
  /**
   * The course's primary domain. It decides which motifs the picture may use,
   * so a course in linguistics never comes out as a double helix — see the
   * table in `shared/procedural.ts`. Absent, every motif is on the table.
   */
  domain?: { id: string; continent: Continent };
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
export default function CourseArt({ courseId, color, domain, className = '', rounded }: Props) {
  // The picture is drawn in the domain's hue over a wash of it, and which way
  // both go depends on the card underneath — so the theme is an input, not a
  // filter applied afterwards.
  const scheme = useResolvedTheme();
  const art = useMemo(
    () =>
      courseArt(
        courseId,
        { id: domain?.id, continent: domain?.continent, color },
        { ...DEFAULT_VISUAL, scheme }
      ),
    [courseId, color, domain?.id, domain?.continent, scheme]
  );

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
