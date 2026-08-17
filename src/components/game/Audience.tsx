import type { BuiltPlaylist } from '@shared/schema';
import { useT } from '@/i18n';
import { audiencePassed, GAME, audienceWidth } from '@/lib/gamification';
import type { PlaylistProgress } from '@/lib/progress';
import Tooltip from '@/components/Tooltip';

/**
 * [game:audience] — where everybody else stopped, and how far past them you are.
 *
 * The catalogue has always known this and has only ever said it about the
 * recording: «досматриваемость 33%», a fact filed with the view count. Read per
 * lecture it is a fact about the reader instead — the one number on the screen
 * that says an eighty-hour course is being taken on by somebody rather than by
 * nobody, and it needs no account, no server and nothing tracked to say it.
 *
 * Two shapes. The line is the position, and it is only drawn once there is one
 * worth naming; the marks down the list are the shape of the crowd, and they
 * are the more useful half — a step in them is the lecture people give up at,
 * which is worth knowing before you arrive at it rather than after.
 *
 * `playlist.audience` is absent on four recordings in ten, and both shapes simply
 * do not appear there. That is the gate `measuredRetention` already applies:
 * on a subject bucket entered from search the ratio computes and means
 * nothing.
 */
export default function AudienceLine({
  playlist,
  progress,
  className = '',
}: {
  playlist: BuiltPlaylist;
  progress: PlaylistProgress;
  className?: string;
}) {
  if (!GAME.audience) return null;
  return <Line playlist={playlist} progress={progress} className={className} />;
}

function Line({
  playlist,
  progress,
  className,
}: {
  playlist: BuiltPlaylist;
  progress: PlaylistProgress;
  className: string;
}) {
  const { t } = useT();
  const passed = audiencePassed(playlist, progress);
  if (passed === null) return null;

  /*
   * The rule travels with the figure, and on a phone it has to be tappable to
   * travel at all. «Аудитория» here is views and the sentence says so: views
   * are not people, and the one place this product is allowed to blur that is
   * nowhere.
   */
  return (
    <Tooltip tap content={t('ui.legend.audience')}>
      <p className={`num cursor-help text-[11px] text-accent ${className}`}>
        {t('ui.game.audience', { percent: passed })}
      </p>
    </Tooltip>
  );
}

/**
 * The crowd at one lecture, as a bar under its number.
 *
 * Painted in the relative tone rather than the accent, which is a deliberate
 * departure from `Meter` — there the accent marks the one bar that is a real
 * share of a real whole, and this is one. On a lecture row the accent already
 * means *you*: the wash behind a part-watched row, the playhead, the tick. A
 * second accent bar two centimetres away, meaning the opposite thing, would
 * make both unreadable. So the reader is green and the crowd is blue, here and
 * nowhere else.
 *
 * No tooltip of its own. Sixty of them down a list is sixty bubbles competing
 * for one pointer, and the sentence is already attached to the line above.
 */
export function AudienceMark({ share }: { share: number | null }) {
  if (!GAME.audience || share === null) return null;

  return (
    <span aria-hidden="true" className="mt-1 block h-[2px] w-full overflow-hidden rounded-full bg-line">
      <span className="block h-full rounded-full bg-formal" style={{ width: `${audienceWidth(share)}%` }} />
    </span>
  );
}
