import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { formatDate } from '@/lib/format';
import { useProfile } from '@/store/profile';
import { useUi } from '@/store/ui';
import Icon from '@/components/Icon';

/**
 * Playlists that were opened, newest first.
 *
 * Titles come from the stored entry rather than the catalogue: a playlist that
 * was deleted from YouTube, or dropped from the catalogue in a later crawl,
 * should still be answerable as "that thing I opened last week" instead of
 * silently vanishing from the history.
 */
export default function RecentTab() {
  const { t, lang } = useT();
  const catalog = useCatalog();
  const navigate = useNavigate();
  const closeProfile = useUi((state) => state.closeProfile);

  const recent = useProfile((state) => state.profile.recent);
  const removeRecent = useProfile((state) => state.removeRecent);
  const clearRecent = useProfile((state) => state.clearRecent);

  const [confirming, setConfirming] = useState(false);

  if (!recent.length) {
    return <p className="p-6 text-center text-sm text-ink-faint">{t('ui.recent.empty')}</p>;
  }

  const open = (courseId: string, playlistId: string): void => {
    closeProfile();
    navigate(`/courses/${encodeURIComponent(courseId)}?playlist=${encodeURIComponent(playlistId)}`);
  };

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="num text-xs text-ink-faint">
          {t('ui.recent.count', { n: recent.length })}
        </span>
        {confirming ? (
          <span className="ml-auto flex items-center gap-2">
            <span className="text-xs text-ink-dim">{t('ui.recent.clearConfirm')}</span>
            <button
              type="button"
              className="btn text-xs text-danger"
              onClick={() => {
                clearRecent();
                setConfirming(false);
              }}
            >
              {t('ui.recent.clearDo')}
            </button>
            <button type="button" className="btn text-xs" onClick={() => setConfirming(false)}>
              {t('ui.common.cancel')}
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="btn-ghost ml-auto text-xs"
            onClick={() => setConfirming(true)}
          >
            {t('ui.recent.clear')}
          </button>
        )}
      </div>

      <ul className="space-y-1.5">
        {recent.map((entry) => {
          const course = catalog.courseById.get(entry.courseId);
          const domain = course ? catalog.domainById.get(course.domains[0]) : undefined;
          return (
            <li key={entry.id} className="surface flex items-center gap-3 p-2">
              <button
                type="button"
                onClick={() => open(entry.courseId, entry.id)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate text-sm text-ink">{entry.title}</span>
                <span className="num block truncate text-xs text-ink-faint">
                  {course ? t(`course.${course.id}.title`) : entry.courseId}
                  {domain ? ` · ${t(`domain.${domain.id}.title`)}` : ''} ·{' '}
                  {formatDate(entry.at, lang)}
                </span>
              </button>
              <button
                type="button"
                className="btn-ghost shrink-0 rounded p-1"
                onClick={() => removeRecent(entry.id)}
                aria-label={`${t('ui.recent.remove')}: ${entry.title}`}
                title={t('ui.recent.remove')}
              >
                <Icon name="close" size={13} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
