import { Link } from 'react-router-dom';
import type { BuiltPlaylist } from '@shared/schema';
import { useT } from '@/i18n';
import { formatHours, hoursFromSeconds } from '@/lib/format';
import { FINISH_MIN_LECTURES, GAME, useUnlocked } from '@/lib/gamification';
import type { PlaylistProgress } from '@/lib/progress';
import Icon from '@/components/Icon';

/**
 * [game:finish] — the end of a long recording as an event, and what it opened.
 *
 * Sixty lectures used to end the way one lecture ends: a checkbox turned
 * green, and a line appeared offering to undo the course status that had
 * changed behind the reader's back. That is the whole of what the product has
 * ever said about eighty hours of somebody's work.
 *
 * What it says instead is not a trophy. The catalogue cannot certify anything
 * and a shelf of badges is the monument the front page already refuses to
 * build — «312 лекций» reads the same on the morning somebody starts again and
 * the morning they give up. It is the graph: the whole claim of this site is
 * that courses come in an order, so a finished course **opens** the ones that
 * stand on it, and that reward is read off `deps` rather than invented.
 *
 * «Открылось» and «Открывает путь к» are deliberately different words. The
 * panel's list is what this course leads to whenever you get there; this one
 * is the courses whose every prerequisite is now behind you, which is a
 * stronger and rarer statement — and the empty case is silent rather than
 * apologetic.
 */
export default function FinishCard({
  playlist,
  progress,
  hrefFor,
}: {
  playlist: BuiltPlaylist;
  progress: PlaylistProgress;
  /** Where a course name leads — the caller owns the query string. */
  hrefFor: (courseId: string) => string;
}) {
  if (!GAME.finish) return null;
  return <Card playlist={playlist} progress={progress} hrefFor={hrefFor} />;
}

function Card({
  playlist,
  progress,
  hrefFor,
}: {
  playlist: BuiltPlaylist;
  progress: PlaylistProgress;
  hrefFor: (courseId: string) => string;
}) {
  const { t, count } = useT();
  const unlocked = useUnlocked(playlist.courseId);

  // Only where finishing was work. A recording of five lectures ends, it is not
  // *finished*, and a card congratulating somebody for twenty minutes is the
  // kind of thing that teaches people to stop reading the interface.
  if (!progress.complete || playlist.videos.length < FINISH_MIN_LECTURES) return null;

  return (
    <div className="rounded-card border border-accent/40 bg-accent-soft px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-accent">
        <Icon name="check" size={13} />
        {t('ui.game.finish')}
      </p>
      {/* Summed from the rows, which is what makes it printable: these lectures,
          this many hours. Nothing about the course they belong to. */}
      <p className="num ink-soft mt-0.5 text-[11px]">
        {t('ui.game.finishSize', {
          lectures: count(progress.total, 'lecture'),
          hours: t('ui.playlist.hours', {
            n: formatHours(hoursFromSeconds(progress.totalSeconds)),
          }),
        })}
      </p>

      {unlocked.length ? (
        <div className="mt-2.5 border-t border-accent/25 pt-2">
          <p className="mono-label ink-soft">{t('ui.game.unlocked')}</p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {unlocked.map((id) => (
              <li key={id}>
                {/* `replace`, like every other way out of this dialog: the way
                    back is the view the player was opened over, not the player
                    again. */}
                <Link
                  to={hrefFor(id)}
                  replace
                  className="inlay flex items-center gap-1 px-2 py-1 text-xs text-ink
                             transition-colors duration-fast ease-out hover:text-accent"
                >
                  {t(`course.${id}.title`)}
                  <Icon name="chevron-right" size={12} className="shrink-0 text-ink-faint" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
