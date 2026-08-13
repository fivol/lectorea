import { memo } from 'react';
import type { BuiltPlaylist, PlaylistStatus } from '@shared/schema';
import { formatCompact, useT } from '@/i18n';
import { formatHours, hoursFromSeconds } from '@/lib/format';
import { percent, playlistProgress } from '@/lib/progress';
import { useProfile } from '@/store/profile';
import Icon from '@/components/Icon';
import ProgressBar from '@/components/ProgressBar';
import Tooltip from '@/components/Tooltip';
import type { LabelParts } from './playlist-label';

type Props = {
  playlist: BuiltPlaylist;
  /** Source-first heading for this row; see playlist-label.ts. */
  label: LabelParts;
  onOpen: (id: string) => void;
};

/**
 * One row of the list. Only marks, never raw views and likes: those numbers turn
 * the list into a spreadsheet and make it harder, not easier, to compare.
 */
function PlaylistRowInner({ playlist, label, onOpen }: Props) {
  const { t, count } = useT();
  const profile = useProfile((state) => state.profile);
  const favorite = useProfile((state) => state.profile.playlists[playlist.id]?.favorite ?? false);
  const progress = playlistProgress(profile, playlist);
  const watched = progress.complete;

  const thumbnail = playlist.videos[0]?.id
    ? `https://i.ytimg.com/vi/${playlist.videos[0].id}/mqdefault.jpg`
    : null;

  /*
   * Once a playlist is under way, the two facts that describe it — how many
   * lectures and how long they run — are superseded by how much of each is
   * behind you, so the progress takes their place rather than being squeezed in
   * beside them. Nothing is lost: both numbers are still there, and both are
   * now about the reader.
   */
  const subtitle = (
    progress.started
      ? [
          t('ui.profile.progress', { done: progress.done, total: progress.total }),
          t('ui.playlist.hoursOf', {
            n: formatHours(hoursFromSeconds(progress.watchedSeconds)),
            of: formatHours(hoursFromSeconds(progress.totalSeconds)),
          }),
          playlist.year ? String(playlist.year) : null,
          playlist.lang,
        ]
      : [
          count(playlist.videoCount, 'lecture'),
          t(`ui.playlist.length.${playlist.lectureLength}`),
          playlist.year ? String(playlist.year) : null,
          playlist.lang,
        ]
  )
    .filter(Boolean)
    .join(' · ');

  /*
   * The card is a container with the row inside it rather than one big button,
   * so the bar can sit underneath as a sibling.
   *
   * It used to be four pixels along the foot of the thumbnail, which is where
   * every video player in the world puts it — but a player puts it on a frame
   * that fills the screen, and here the frame is seventy by forty and often
   * dark. It was unreadable. Given its own line under the row it is the same
   * bar the panel and the profile draw, at the width of the card, and the row
   * grows by twelve pixels to hold it.
   *
   * The hover lives on the container so the whole card lights up, bar included.
   */
  return (
    <div
      className={`rounded-card border border-transparent px-2 py-2 transition-colors
                  duration-fast ease-out hover:border-line-strong hover:bg-surface-2
                  ${watched ? 'opacity-70' : ''}`}
    >
      <button
        type="button"
        onClick={() => onOpen(playlist.id)}
        className="flex w-full items-center gap-3 text-left"
      >
        {/* Fixed size, so a thumbnail that never arrives costs no layout shift. */}
        <span className="h-10 w-[70px] shrink-0 overflow-hidden rounded bg-surface-2">
          {thumbnail ? (
            <img
              src={thumbnail}
              alt=""
              loading="lazy"
              width={70}
              height={40}
              className="h-full w-full object-cover"
              onError={(event) => {
                event.currentTarget.style.display = 'none';
              }}
            />
          ) : null}
        </span>

        <span className="min-w-0 flex-1">
          {/* The canonical name lives in the tooltip and in the player: the row
              says who made it and which of theirs it is. */}
          <Tooltip content={label.detail}>
            <span className="block truncate text-caption text-ink">{label.heading}</span>
          </Tooltip>
          <span className="num mt-0.5 block truncate text-[11px] text-ink-faint">{subtitle}</span>
        </span>

        <span className="flex shrink-0 items-center gap-1.5">
          {favorite ? (
            <Tooltip content={t('ui.course.favoriteOn')}>
              <span className="inline-flex text-warning">
                <Icon name="star-filled" size={13} />
              </span>
            </Tooltip>
          ) : null}
          {watched ? (
            <Tooltip content={t('ui.playlist.watchedOn')}>
              <span className="inline-flex text-accent">
                <Icon name="check" size={13} />
              </span>
            </Tooltip>
          ) : null}
          <StatusBadge playlist={playlist} />
        </span>
      </button>

      {/* Only while there is a way to go. A finished playlist is already dimmed
          and ticked, and a full bar on every one of them would add a line to
          half the list to repeat what the tick says. */}
      {progress.started && !watched ? (
        <ProgressBar
          className="mt-1.5"
          done={progress.done}
          total={progress.total}
          fill={progress.fraction}
          label={`${percent(progress.fraction)}%`}
        />
      ) : null}
    </div>
  );
}

/**
 * How each status looks. Praise is accent, a caveat about the data is faint,
 * and a shape is neutral — the colour repeats what the word says rather than
 * carrying meaning of its own, so the row still reads without it.
 */
const STATUS_TONE: Record<Exclude<PlaylistStatus, 'none'>, { colour: string; text: string }> = {
  excellent: { colour: 'var(--c-accent)', text: 'text-accent' },
  retained: { colour: 'var(--c-accent)', text: 'text-accent' },
  liked: { colour: 'var(--c-accent)', text: 'text-accent' },
  discussed: { colour: 'var(--c-warning)', text: 'text-warning' },
  reaching: { colour: 'var(--c-warning)', text: 'text-warning' },
  classic: { colour: 'var(--c-warning)', text: 'text-warning' },
  assorted: { colour: 'var(--c-ink-faint)', text: 'text-ink-faint' },
  fresh: { colour: 'var(--c-ink-faint)', text: 'text-ink-faint' },
  sparse: { colour: 'var(--c-ink-faint)', text: 'text-ink-faint' },
};

/**
 * The one word the row says about a playlist.
 *
 * It replaced a number out of 100, which was worse in both directions: it
 * implied a precision the data does not have, and it forced a verdict on every
 * playlist including the two thirds the data has nothing to say about. A word
 * can be absent. The tooltip always says what earned it, because an unexplained
 * badge is a decision nobody can check.
 */
export function StatusBadge({ playlist }: { playlist: BuiltPlaylist }) {
  const { t } = useT();
  if (playlist.status === 'none') {
    return (
      <Tooltip content={t('ui.playlist.noStatusHint')}>
        <span className="h-2 w-2 rounded-full border border-line-strong" aria-hidden />
      </Tooltip>
    );
  }

  const tone = STATUS_TONE[playlist.status];
  const retention =
    playlist.retention !== undefined && playlist.curve !== 'assorted'
      ? t('ui.playlist.retentionValue', { percent: `${Math.round(playlist.retention * 100)}%` })
      : null;

  return (
    <Tooltip
      content={
        <>
          <span className="block font-semibold">{t(`ui.playlist.status.${playlist.status}`)}</span>
          <span className="mt-1 block">{t(`ui.playlist.status.${playlist.status}.hint`)}</span>
          {retention ? <span className="num mt-1 block opacity-80">{retention}</span> : null}
        </>
      }
    >
      <span className={`flex items-center gap-1 whitespace-nowrap text-[11px] ${tone.text}`}>
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: tone.colour }} />
        {t(`ui.playlist.status.${playlist.status}`)}
      </span>
    </Tooltip>
  );
}

export function playlistViews(playlist: BuiltPlaylist, lang: string): string {
  return formatCompact(playlist.stats.views, lang);
}

export default memo(PlaylistRowInner);
