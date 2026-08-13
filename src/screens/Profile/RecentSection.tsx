import { useState } from 'react';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { formatDate, formatDuration } from '@/lib/format';
import { useRecentWatch } from '@/lib/progress';
import { useProfile } from '@/store/profile';
import ProgressBar from '@/components/ProgressBar';
import { Button, IconButton } from '@/components/ui';
import { useProfileNavigation } from './navigate';

/**
 * Playlists that were opened, newest first.
 *
 * Titles come from the stored entry rather than the catalogue: a playlist that
 * was deleted from YouTube, or dropped from the catalogue in a later crawl,
 * should still be answerable as "that thing I opened last week" instead of
 * silently vanishing from the history.
 */
export default function RecentSection({ limit }: { limit?: number }) {
  const { t, lang } = useT();
  const catalog = useCatalog();
  const { openPlaylist } = useProfileNavigation();

  const recent = useProfile((state) => state.profile.recent);
  const removeRecent = useProfile((state) => state.removeRecent);
  const watched = useRecentWatch();

  const shown = limit === undefined ? recent : recent.slice(0, limit);

  return (
    <ul className="space-y-1.5">
      {shown.map((entry) => {
        const course = catalog.courseById.get(entry.courseId);
        const domain = course ? catalog.domainById.get(course.domains[0]) : undefined;
        const watch = watched.get(entry.id);
        return (
          <li key={entry.id} className="surface flex items-center gap-3 p-2">
            <button
              type="button"
              onClick={() => openPlaylist(entry.courseId, entry.id)}
              className="min-w-0 flex-1 text-left"
            >
              <span className="block truncate text-sm text-ink">{entry.title}</span>
              <span className="num block truncate text-xs text-ink-faint">
                {course ? t(`course.${course.id}.title`) : entry.courseId}
                {domain ? ` · ${t(`domain.${domain.id}.title`)}` : ''} ·{' '}
                {formatDate(entry.at, lang)}
              </span>
              {/* Only for the few most recent, whose playlists are loaded —
                  see `useRecentWatch`. The rest of the history is a list of
                  names, which is what history is. */}
              {watch?.progress.started ? (
                <ProgressBar
                  className="mt-1.5"
                  done={watch.progress.done}
                  total={watch.progress.total}
                  fill={watch.progress.fraction}
                  label={
                    watch.progress.complete
                      ? t('ui.playlist.watchedOn')
                      : t('ui.profile.continueAt', {
                          n: (watch.progress.next?.index ?? 0) + 1,
                          total: watch.progress.total,
                          at: watch.progress.next?.sec
                            ? formatDuration(watch.progress.next.sec)
                            : t('ui.profile.continueStart'),
                        })
                  }
                />
              ) : null}
            </button>
            {/* Only in the full list. The preview is three rows of what you
                were doing lately, and a row you can delete from a summary is a
                row that has to be aimed past. */}
            {limit === undefined ? (
              <IconButton
                icon="close"
                iconSize={13}
                label={`${t('ui.recent.remove')}: ${entry.title}`}
                className="shrink-0"
                onClick={() => removeRecent(entry.id)}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Clearing the lot, behind the one confirmation it deserves. */
export function ClearRecent() {
  const { t } = useT();
  const clearRecent = useProfile((state) => state.clearRecent);
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button variant="ghost" small onClick={() => setConfirming(true)}>
        {t('ui.recent.clear')}
      </Button>
    );
  }

  return (
    <span className="flex items-center gap-2">
      <span className="text-xs text-ink-dim">{t('ui.recent.clearConfirm')}</span>
      <Button
        small
        className="text-danger"
        onClick={() => {
          clearRecent();
          setConfirming(false);
        }}
      >
        {t('ui.recent.clearDo')}
      </Button>
      <Button small onClick={() => setConfirming(false)}>
        {t('ui.common.cancel')}
      </Button>
    </span>
  );
}
