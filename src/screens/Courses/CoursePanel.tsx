import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import type { BuiltCourse } from '@shared/schema';
import { useT } from '@/i18n';
import { unlocksOf, useCatalog } from '@/lib/catalog';
import { formatHours, inkOn, withAlpha } from '@/lib/format';
import { courseHref } from '@/lib/url';
import { useProfile, useResolvedTheme } from '@/store/profile';
import { useUi } from '@/store/ui';
import Icon from '@/components/Icon';
import PathBlock from './PathBlock';
import CourseLinkCard from './CourseLinkCard';
import PlaylistList, { fixDataUrl, suggestPlaylistUrl } from './PlaylistList';

type Props = {
  course: BuiltCourse;
  search: string;
  /** How many path courses the active domain filter would hide. */
  outsideFilter?: number;
  /** Clears the selection. Absent on mobile, where the sheet has its own close. */
  onClose?: () => void;
};

/** Everything known about the selected course, in the order it is needed. */
export default function CoursePanel({ course, search, outsideFilter = 0, onClose }: Props) {
  const { t, count, has } = useT();
  const catalog = useCatalog();
  const status = useProfile((state) => state.profile.courses[course.id]?.status ?? null);
  const favorite = useProfile((state) => state.profile.courses[course.id]?.favorite ?? false);
  const cycleStatus = useProfile((state) => state.cycleCourseStatus);
  const toggleFavorite = useProfile((state) => state.toggleCourseFavorite);
  const setEcho = useUi((state) => state.setEcho);
  const scheme = useResolvedTheme();

  /**
   * The echo is set by hovering a link in here and cleared on mouse-out — but
   * closing the panel unmounts it from under the cursor, so that mouse-out
   * never arrives and the highlight stays pinned to a course nothing is
   * pointing at any more. Clearing on unmount covers every way the panel can go
   * away: the ×, a click on the background, a filter change, navigation.
   */
  useEffect(() => () => setEcho(null), [setEcho]);

  const domains = course.domains
    .map((id) => catalog.domainById.get(id))
    .filter((domain): domain is NonNullable<typeof domain> => Boolean(domain));

  const unlocks = unlocksOf(catalog, course.id);

  return (
    <div className="panel-scroll h-full">
      <header className="px-4 pb-3 pt-4">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {domains.map((domain) => (
            <Link
              key={domain.id}
              to={`/courses?domain=${encodeURIComponent(domain.id)}`}
              className="chip"
              style={{ color: inkOn(domain.color, scheme), borderColor: withAlpha(domain.color, 0.4) }}
            >
              {t(`domain.${domain.id}.title`)}
            </Link>
          ))}
          <span className="num chip">{t(`ui.stage.${course.stage}`)}</span>
          <span className="num chip">{t('ui.course.level', { n: course.level + 1 })}</span>
          {course.hours ? (
            <span className="num chip">{t('ui.course.hoursShort', { n: formatHours(course.hours) })}</span>
          ) : null}
          {onClose ? (
            <button
              type="button"
              className="btn-ghost ml-auto rounded p-1"
              onClick={onClose}
              aria-label={t('ui.course.deselect')}
              title={t('ui.course.deselect')}
            >
              <Icon name="close" size={14} />
            </button>
          ) : null}
        </div>

        <h2 className="font-display text-h1">{t(`course.${course.id}.title`)}</h2>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <button
            type="button"
            className={`btn ${favorite ? 'btn-primary' : ''}`}
            onClick={() => toggleFavorite(course.id)}
            aria-pressed={favorite}
          >
            <Icon name={favorite ? 'star-filled' : 'star'} />
            {favorite ? t('ui.course.favoriteOn') : t('ui.course.favorite')}
          </button>
          {/* The label names what the click does, not what the course already
              is — "Не начат" beside a dot read as a disabled badge. The state
              is still legible, from the icon and the filled button. */}
          <button
            type="button"
            className={`btn ${status ? 'btn-primary' : ''}`}
            onClick={() => cycleStatus(course.id)}
            title={t('ui.course.statusToggle')}
          >
            <Icon name={status === 'done' ? 'check' : status === 'in_progress' ? 'half' : 'circle'} />
            {status === 'done'
              ? t('ui.course.done')
              : status === 'in_progress'
                ? t('ui.course.finish')
                : t('ui.course.start')}
          </button>
        </div>
      </header>

      <section className="px-4 pb-4">
        <p className="text-body text-ink-dim">
          {has(`course.${course.id}.desc`)
            ? t(`course.${course.id}.desc`)
            : t('ui.course.description.missing')}
        </p>
      </section>

      {/* The two directions of one relation, so: one card, mirrored headings,
          and adjacent — one of them used to be stranded below the playlists.
          The full chain follows both rather than splitting them, since it is
          the first one expanded and belongs after the pair, not inside it. */}
      <section className="border-t border-line px-4 py-4">
        <h3 className="mb-2 text-sm font-medium">{t('ui.prereq.title')}</h3>
        {course.deps.length ? (
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {course.deps.map((id) => (
              <li key={id}>
                <CourseLinkCard courseId={id} search={search} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-faint">{t('ui.path.empty')}</p>
        )}
      </section>

      <section className="border-t border-line px-4 py-4">
        <h3 className="mb-2 text-sm font-medium">{t('ui.unlocks.title')}</h3>
        {unlocks.length ? (
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {unlocks.map((step) => (
              <li key={step.id}>
                <CourseLinkCard courseId={step.id} search={search} behind={step.behind} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-faint">{t('ui.unlocks.empty')}</p>
        )}
      </section>

      <PathBlock course={course} search={search} outsideFilter={outsideFilter} />

      <PlaylistList course={course} />

      {course.soft.length || course.related.length ? (
        <section className="border-t border-line px-4 py-4 text-sm">
          {course.soft.length ? (
            <p className="mb-2 text-ink-faint">
              {t('ui.course.recommends')}:{' '}
              {course.soft.map((id, index) => (
                <span key={id}>
                  {index ? ', ' : ''}
                  <Link to={courseHref(id, search)} className="text-ink-dim hover:text-ink">
                    {t(`course.${id}.title`)}
                  </Link>
                </span>
              ))}
            </p>
          ) : null}
          {course.related.length ? (
            <p className="text-ink-faint">
              {t('ui.course.relatedTo')}:{' '}
              {course.related.map((id, index) => (
                <span key={id}>
                  {index ? ', ' : ''}
                  <Link to={courseHref(id, search)} className="text-ink-dim hover:text-ink">
                    {t(`course.${id}.title`)}
                  </Link>
                </span>
              ))}
            </p>
          ) : null}
        </section>
      ) : null}

      <footer className="flex flex-wrap gap-3 border-t border-line px-4 py-3 text-xs text-ink-faint">
        <a
          href={fixDataUrl(course.id, course.domains[0])}
          target="_blank"
          rel="noreferrer noopener"
          className="hover:text-ink-dim"
        >
          {t('ui.course.fixData')}
        </a>
        <a
          href={suggestPlaylistUrl(course.id)}
          target="_blank"
          rel="noreferrer noopener"
          className="hover:text-ink-dim"
        >
          {t('ui.course.suggestPlaylist')}
        </a>
        <span className="ml-auto">{count(course.playlistCount, 'playlist')}</span>
      </footer>
    </div>
  );
}
