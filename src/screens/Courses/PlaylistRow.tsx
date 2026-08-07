import { memo } from 'react';
import type { BuiltPlaylist } from '@shared/schema';
import { formatCompact, useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { formatHours, hoursFromSeconds } from '@/lib/format';
import { useProfile } from '@/store/profile';
import Icon from '@/components/Icon';

type Props = {
  playlist: BuiltPlaylist;
  onOpen: (id: string) => void;
};

/**
 * One row of the list. Only marks, never raw views and likes: those numbers turn
 * the list into a spreadsheet and make it harder, not easier, to compare.
 */
function PlaylistRowInner({ playlist, onOpen }: Props) {
  const { t, count } = useT();
  const catalog = useCatalog();
  const watched = useProfile((state) => state.profile.playlists[playlist.id]?.watched ?? false);
  const favorite = useProfile((state) => state.profile.playlists[playlist.id]?.favorite ?? false);

  const provider = catalog.providers[playlist.providerId];
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
      className={`flex w-full items-center gap-3 rounded-lg border border-transparent px-2 py-2
                  text-left hover:border-line hover:bg-surface-2 ${watched ? 'opacity-70' : ''}`}
    >
      <span className="relative h-10 w-[70px] shrink-0 overflow-hidden rounded bg-surface-2">
        {thumbnail ? (
          <img
            src={thumbnail}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
            onError={(event) => {
              event.currentTarget.style.display = 'none';
            }}
          />
        ) : null}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-ink">
          {playlist.title}
          {provider ? <span className="text-ink-faint"> — {provider.title}</span> : null}
          {playlist.lecturer ? <span className="text-ink-faint">, {playlist.lecturer}</span> : null}
        </span>
        <span className="num mt-0.5 block truncate text-xs text-ink-faint">{subtitle}</span>
      </span>

      <span className="flex shrink-0 items-center gap-1.5">
        {favorite ? <Icon name="star-filled" size={13} className="text-social" /> : null}
        {watched ? <Icon name="check" size={13} className="text-accent" /> : null}
        <QualityDot playlist={playlist} />
      </span>
    </button>
  );
}

export function QualityDot({ playlist }: { playlist: BuiltPlaylist }) {
  const { t } = useT();
  const percent = playlist.scorePercent;
  const colour =
    percent >= 75
      ? 'var(--c-accent)'
      : percent >= 50
        ? 'var(--c-formal)'
        : percent >= 25
          ? 'var(--c-social)'
          : 'var(--c-ink-faint)';

  return (
    <span
      className="num flex items-center gap-1 text-[11px] text-ink-faint"
      title={t('ui.playlist.scoreTooltip', {
        score: percent,
        engagement: `${(playlist.engagement * 100).toFixed(2)}%`,
      })}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: colour }} />
      {percent}
    </span>
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
