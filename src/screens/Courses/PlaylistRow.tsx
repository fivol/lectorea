import { memo } from 'react';
import {
  measuredRetention,
  playlistTypeOf,
  type BuiltPlaylist,
  type PlaylistStatus,
} from '@shared/schema';
import { formatCompact, useT } from '@/i18n';
import { formatHours, hoursFromSeconds } from '@/lib/format';
import { percent, playlistProgress } from '@/lib/progress';
import { useProfile } from '@/store/profile';
import Icon from '@/components/Icon';
import ProgressBar from '@/components/ProgressBar';
import Tooltip from '@/components/Tooltip';
import type { LabelParts } from './playlist-label';
import { partLabel, saysItsPart } from './series';

type Props = {
  playlist: BuiltPlaylist;
  /** The recording's own name and who recorded it; see playlist-label.ts. */
  label: LabelParts;
  /** «Русский», or null when the filter makes the language a foregone conclusion. */
  language: string | null;
  /**
   * True while the list is ordered by retention — see the subtitle below.
   *
   * A boolean rather than the sort key itself: this is the one order whose
   * number the row is otherwise silent about, and the only one it is asked to
   * explain. Views and likes stay off the row whatever it is sorted by.
   */
  showRetention: boolean;
  onOpen: (id: string) => void;
};

/**
 * One row of the list. Only marks, never raw views and likes: those numbers turn
 * the list into a spreadsheet and make it harder, not easier, to compare.
 */
function PlaylistRowInner({ playlist, label, language, showRetention, onOpen }: Props) {
  const { t, count } = useT();
  const profile = useProfile((state) => state.profile);
  const favorite = useProfile((state) => state.profile.playlists[playlist.id]?.favorite ?? false);
  const progress = playlistProgress(profile, playlist);
  const watched = progress.complete;

  const thumbnail = playlist.videos[0]?.id
    ? `https://i.ytimg.com/vi/${playlist.videos[0].id}/mqdefault.jpg`
    : null;

  /*
   * The second line is everything about the recording that is not its name: the
   * year it was filmed, the language when the filter admits more than one, and
   * how much of it there is. The year sat in the heading while the heading was
   * «МФТИ · 2016» and was the only thing in it that separated two rows; now
   * that the recording's own name leads, the year is one fact among the facts.
   *
   * Once the playlist is under way, how much of it is behind you supersedes how
   * much of it there is. Nothing is lost in the swap — both numbers are still
   * on the line, and both are now about the reader.
   *
   * The exception is the number the list is currently ordered by. Sorting by
   * «Досматриваемость» used to reshuffle the panel and say nothing about why,
   * which is a list asking to be taken on faith; so while that order is on, the
   * share who reach the end leads the line — including the rows that have no
   * such share, which is why they are at the bottom.
   */
  const retention = measuredRetention(playlist);
  const retentionLabel = !showRetention
    ? null
    : retention === null
      ? t('ui.playlist.retentionUnknown')
      : t('ui.playlist.retentionShort', { percent: `${Math.round(retention * 100)}%` });

  const subtitle = [
    retentionLabel,
    ...(progress.started
      ? [
          language,
          // Named, because «4 из 15 · 6.1 из 21 ч» is two bare ratios in a row
          // and the eye has to work out which of them is which.
          t('ui.course.lecturesDone', { done: progress.done, total: progress.total }),
          t('ui.playlist.hoursOf', {
            n: formatHours(hoursFromSeconds(progress.watchedSeconds)),
            of: formatHours(hoursFromSeconds(progress.totalSeconds)),
          }),
        ]
      : [
          playlist.year ? String(playlist.year) : null,
          language,
          count(playlist.videoCount, 'lecture'),
          // How long the whole thing runs, not what one lecture is called.
          // «пара» was a word for a number the reader already had — 15 lectures
          // of about ninety minutes — and it answered the question nobody asks
          // first. «21 ч» answers «can I take this on», and the average is
          // still one division away for anyone who wants it.
          t('ui.playlist.hours', { n: formatHours(hoursFromSeconds(playlist.totalSeconds)) }),
        ]),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <button
      type="button"
      onClick={() => onOpen(playlist.id)}
      className={`flex w-full items-center gap-3 rounded-card border border-transparent px-2 py-2
                  text-left transition-colors duration-fast ease-out
                  hover:border-line-strong hover:bg-surface-2 ${watched ? 'opacity-80' : ''}`}
    >
      {/* Fixed size, so a thumbnail that never arrives costs no layout shift.
          Sized to the two lines and the bar beside it rather than to the two
          lines alone: a row this tall with a stamp-sized frame in it reads as a
          list that lost its pictures. */}
      <span className="h-[54px] w-24 shrink-0 overflow-hidden rounded bg-surface-2">
        {thumbnail ? (
          <img
            src={thumbnail}
            alt=""
            loading="lazy"
            width={96}
            height={54}
            className="h-full w-full object-cover"
            onError={(event) => {
              event.currentTarget.style.display = 'none';
            }}
          />
        ) : null}
      </span>

      <span className="min-w-0 flex-1">
        {/* The recording's own name, then who recorded it in a quieter colour.
            Two tones rather than two lines: it is one answer to one question —
            «which of these am I looking at» — and the tail is the half of it
            that repeats down the list. The whole title, course name and all,
            lives in the tooltip and in the player. */}
        <Tooltip content={label.detail}>
          <span className="block truncate text-caption text-ink">
            {/* Which part of the run this is, in the university's own word.
                Ahead of the name because inside a run it is the only thing that
                tells two otherwise identical rows apart. */}
            {playlist.series && !saysItsPart(playlist.series, label.name ?? label.source) ? (
              <span className="num mr-1.5 text-ink-faint">{partLabel(playlist.series, t)} ·</span>
            ) : null}
            {label.name ? (
              <>
                {label.name}
                {label.source ? <span className="text-ink-faint"> · {label.source}</span> : null}
              </>
            ) : (
              label.source
            )}
          </span>
        </Tooltip>
        <span className="num mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-ink-faint">
          {/* Filled, and first on the line, because it is the one label here
              that is about the reader. It used to be a tick in the right-hand
              column over a row at 70% opacity, which is two faint signals for
              a fact that decides whether the row is worth reading at all. The
              solid fill also survives the dimming the tick was lost in. */}
          {watched ? (
            // The same plate the course card wears when it is finished — see
            // `StatusMark`. One vocabulary for «this is behind you», whether the
            // thing behind you is a course or one recording of it.
            <span
              className="mark-pop inline-flex h-[18px] shrink-0 items-center gap-1 rounded-full
                         bg-accent px-1.5 text-[10px] font-medium leading-none text-canvas"
            >
              <Icon name="check" size={10} />
              {t('ui.playlist.watchedBadge')}
            </span>
          ) : null}
          <TypeBadge playlist={playlist} />
          <span className="truncate">{subtitle}</span>
        </span>

        {/* Inside the text column, so it runs from the picture to the status and
            under neither of them: a bar that starts under a thumbnail is not
            measuring the thumbnail, and one that runs beneath the status word
            reads as belonging to it.

            Only while there is a way to go — a finished playlist already wears
            «Просмотрено» in solid accent, and a full bar on every one of those
            would add a line to half the list to say it a second time. */}
        {progress.started && !watched ? (
          <ProgressBar
            // Held clear of the status word on the right: the percentage and
            // «Нравится» are both small grey type on the same optical line, and
            // with only the row's own gap between them they read as one label
            // that has come apart.
            className="mt-1.5 pr-10"
            done={progress.done}
            total={progress.total}
            fill={progress.fraction}
            label={`${percent(progress.fraction)}%`}
          />
        ) : null}
      </span>

      <span className="flex shrink-0 items-center gap-1.5">
        {favorite ? (
          <Tooltip content={t('ui.course.favoriteOn')}>
            <span className="inline-flex text-warning">
              <Icon name="star-filled" size={13} />
            </span>
          </Tooltip>
        ) : null}
        <StatusBadge playlist={playlist} />
      </span>
    </button>
  );
}

/**
 * What the playlist is, said in one word beside the facts.
 *
 * Four of the five types are printed: `lectures` is two thirds of a lecture
 * catalogue and a badge everybody wears separates nobody. «Подборка» carries a
 * warning colour because it is the one that changes what you would do with the
 * thing — a shelf is entered anywhere, a course is started at the top.
 */
const TYPE_TONE: Record<'collection' | 'seminars' | 'course' | 'uneven', string> = {
  collection: 'border-warning text-warning',
  seminars: 'border-line-strong text-ink-dim',
  course: 'border-line-strong text-ink-dim',
  uneven: 'border-line-strong text-ink-dim',
};

export function TypeBadge({ playlist }: { playlist: BuiltPlaylist }) {
  const { t } = useT();
  const type = playlistTypeOf(playlist);
  if (type === 'lectures') return null;

  return (
    <Tooltip content={t(`ui.playlist.type.${type}.hint`)}>
      <span
        className={`shrink-0 rounded-chip border px-1.5 py-px text-[10px] leading-4 ${TYPE_TONE[type]}`}
      >
        {t(`ui.playlist.type.${type}`)}
      </span>
    </Tooltip>
  );
}

/**
 * How each status looks. Praise is accent, a caveat about the data is faint —
 * the colour repeats what the word says rather than carrying meaning of its
 * own, so the row still reads without it.
 */
const STATUS_TONE: Record<Exclude<PlaylistStatus, 'none'>, { colour: string; text: string }> = {
  excellent: { colour: 'var(--c-accent)', text: 'text-accent' },
  retained: { colour: 'var(--c-accent)', text: 'text-accent' },
  liked: { colour: 'var(--c-accent)', text: 'text-accent' },
  discussed: { colour: 'var(--c-warning)', text: 'text-warning' },
  reaching: { colour: 'var(--c-warning)', text: 'text-warning' },
  classic: { colour: 'var(--c-warning)', text: 'text-warning' },
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
 *
 * What the playlist *is* is not said here — that is `TypeBadge`, on the line
 * below. A row can now carry both, which is the point: «Подборка» used to
 * occupy this slot and silence the rating of every shelf in the catalogue.
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
  const measured = measuredRetention(playlist);
  const retention =
    measured === null
      ? null
      : t('ui.playlist.retentionValue', { percent: `${Math.round(measured * 100)}%` });

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
