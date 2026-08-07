import { memo } from 'react';
import type { BuiltPlaylist } from '@shared/schema';
import { formatCompact, useT } from '@/i18n';
import { formatHours, hoursFromSeconds } from '@/lib/format';
import { useProfile } from '@/store/profile';
import Icon from '@/components/Icon';
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
  const watched = useProfile((state) => state.profile.playlists[playlist.id]?.watched ?? false);
  const favorite = useProfile((state) => state.profile.playlists[playlist.id]?.favorite ?? false);

  const thumbnail = playlist.videos[0]?.id
    ? `https://i.ytimg.com/vi/${playlist.videos[0].id}/mqdefault.jpg`
    : null;

  const subtitle = [
    count(playlist.videoCount, 'lecture'),
    t(`ui.playlist.length.${playlist.lectureLength}`),
    playlist.year ? String(playlist.year) : null,
    playlist.lang,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <button
      type="button"
      onClick={() => onOpen(playlist.id)}
      className={`flex w-full items-center gap-3 rounded-card border border-transparent px-2 py-2
                  text-left transition-colors duration-fast ease-out
                  hover:border-line-strong hover:bg-surface-2 ${watched ? 'opacity-70' : ''}`}
    >
      {/* Fixed size, so a thumbnail that never arrives costs no layout shift. */}
      <span className="relative h-10 w-[70px] shrink-0 overflow-hidden rounded bg-surface-2">
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
        {favorite ? <Icon name="star-filled" size={13} className="text-warning" /> : null}
        {watched ? <Icon name="check" size={13} className="text-accent" /> : null}
        <QualityDot playlist={playlist} />
      </span>
    </button>
  );
}

/**
 * The quality mark: a colour and the number beside it, never colour alone.
 *
 * The scale is the one in the design system — high, middling, and "too little
 * to tell" — and the tooltip says what the number is actually made of, because
 * an unexplained 61 next to an unexplained 49 is a decision nobody can make.
 */
export function QualityDot({ playlist }: { playlist: BuiltPlaylist }) {
  const { t } = useT();
  const percent = playlist.scorePercent;
  const colour =
    percent >= 70 ? 'var(--c-accent)' : percent >= 40 ? 'var(--c-warning)' : 'var(--c-ink-faint)';
  const band = percent >= 70 ? 'high' : percent >= 40 ? 'mid' : 'low';

  return (
    <Tooltip
      content={
        <>
          <span className="block font-semibold">
            {t(`ui.playlist.scoreBand.${band}`, { score: percent })}
          </span>
          <span className="mt-1 block">{t('ui.playlist.scoreTooltip')}</span>
          <span className="num mt-1 block opacity-80">
            {t('ui.playlist.scoreEngagement', {
              engagement: `${(playlist.engagement * 100).toFixed(2)}%`,
            })}
          </span>
        </>
      }
    >
      <span className="num flex items-center gap-1 text-[11px] text-ink-faint">
        <span className="h-2 w-2 rounded-full" style={{ background: colour }} />
        {percent}
      </span>
    </Tooltip>
  );
}

/** Duration summary used by both the row and the modal. */
export function playlistDuration(playlist: BuiltPlaylist): string {
  return `${formatHours(hoursFromSeconds(playlist.totalSeconds))} ч`;
}

export function playlistViews(playlist: BuiltPlaylist, lang: string): string {
  return formatCompact(playlist.stats.views, lang);
}

export default memo(PlaylistRowInner);
