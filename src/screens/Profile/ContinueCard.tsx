import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { formatDuration } from '@/lib/format';
import { percent, useContinue } from '@/lib/progress';
import Icon from '@/components/Icon';
import ProgressBar from '@/components/ProgressBar';
import { useProfileNavigation } from './navigate';

/**
 * One press back into the middle of a lecture.
 *
 * The first thing in the profile, above everything else, because it is the only
 * card here that is about right now: the rest is a set of shelves holding
 * things somebody decided at some point, and this is the thing they were doing
 * when they stopped. Absent entirely until there is something to come back to —
 * a «продолжить» that starts a course from nothing is just a course.
 */
export default function ContinueCard() {
  const { t } = useT();
  const catalog = useCatalog();
  const { openPlaylist } = useProfileNavigation();
  const target = useContinue();

  if (!target) return null;

  const { entry, playlist, progress } = target;
  const next = progress.next!;
  const course = catalog.courseById.get(entry.courseId);

  return (
    <section>
      <h3 className="mb-3 text-sm font-medium">{t('ui.profile.continue')}</h3>
      <button
        type="button"
        onClick={() => openPlaylist(entry.courseId, playlist.id)}
        className="surface flex w-full gap-3 overflow-hidden p-3 text-left transition-colors
                   duration-fast ease-out hover:border-accent"
      >
        <span className="relative h-14 w-24 shrink-0 overflow-hidden rounded bg-surface-2">
          <img
            src={`https://i.ytimg.com/vi/${next.video.id}/mqdefault.jpg`}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-canvas/70 text-ink">
              <Icon name="play" size={12} />
            </span>
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{next.video.title}</span>
          <span className="num mt-0.5 block truncate text-xs text-ink-faint">
            {course ? t(`course.${course.id}.title`) : entry.courseId}
            {' · '}
            {t('ui.profile.continueAt', {
              n: next.index + 1,
              total: progress.total,
              // A lecture opened and left at the first minute resumes from the
              // start, and saying «с 0:00» would be a promise about a place.
              at: next.sec ? formatDuration(next.sec) : t('ui.profile.continueStart'),
            })}
          </span>
          <ProgressBar
            className="mt-2"
            done={progress.done}
            total={progress.total}
            fill={progress.fraction}
            label={`${percent(progress.fraction)}%`}
          />
        </span>
      </button>
    </section>
  );
}
