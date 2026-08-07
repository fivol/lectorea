import { Link } from 'react-router-dom';
import type { BuiltCourse } from '@shared/schema';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { formatHours, withAlpha } from '@/lib/format';
import { courseHref } from '@/lib/url';
import { useProfile } from '@/store/profile';
import { useUi } from '@/store/ui';
import Icon from '@/components/Icon';
import PathBlock from './PathBlock';
import PlaylistList, { fixDataUrl, suggestPlaylistUrl } from './PlaylistList';

type Props = {
  course: BuiltCourse;
  search: string;
  /** How many path courses the active domain filter would hide. */
  outsideFilter?: number;
};

/** Everything known about the selected course, in the order it is needed. */
export default function CoursePanel({ course, search, outsideFilter = 0 }: Props) {
  const { t, count, has } = useT();
  const catalog = useCatalog();
  const status = useProfile((state) => state.profile.courses[course.id]?.status ?? null);
  const favorite = useProfile((state) => state.profile.courses[course.id]?.favorite ?? false);
  const cycleStatus = useProfile((state) => state.cycleCourseStatus);
  const toggleFavorite = useProfile((state) => state.toggleCourseFavorite);
  const setEcho = useUi((state) => state.setEcho);
  const requestFocus = useUi((state) => state.requestFocus);

  const domains = course.domains
    .map((id) => catalog.domainById.get(id))
    .filter((domain): domain is NonNullable<typeof domain> => Boolean(domain));

  return (
    <div className="panel-scroll h-full">
      <header className="px-4 pb-3 pt-4">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {domains.map((domain) => (
            <Link
              key={domain.id}
              to={`/courses?domain=${encodeURIComponent(domain.id)}`}
              className="chip"
              style={{ color: domain.color, borderColor: withAlpha(domain.color, 0.4) }}
            >
              {t(`domain.${domain.id}.title`)}
            </Link>
          ))}
          <span className="num chip">{t('ui.course.level', { n: course.level + 1 })}</span>
          {course.hours ? (
            <span className="num chip">{t('ui.course.hoursShort', { n: formatHours(course.hours) })}</span>
          ) : null}
        </div>

        <h2 className="font-display text-xl leading-tight">{t(`course.${course.id}.title`)}</h2>

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
          <button
            type="button"
            className={`btn ${status ? 'btn-primary' : ''}`}
            onClick={() => cycleStatus(course.id)}
            aria-label={t('ui.course.statusToggle')}
          >
            <Icon name={status === 'done' ? 'check' : 'half'} />
            {t(`ui.course.status.${status ?? 'none'}`)}
          </button>
        </div>
      </header>

      <section className="px-4 pb-4">
        <p className="text-sm leading-relaxed text-ink-dim">
          {has(`course.${course.id}.desc`)
            ? t(`course.${course.id}.desc`)
            : t('ui.course.description.missing')}
        </p>
      </section>

      <PathBlock course={course} search={search} outsideFilter={outsideFilter} />

      <PlaylistList course={course} />

      <section className="border-t border-line px-4 py-4">
        <h3 className="mb-2 text-sm font-medium">{t('ui.unlocks.title')}</h3>
        {course.reachDown.length ? (
          <div className="flex flex-wrap gap-1.5">
            {course.reachDown.map((step) => {
              const next = catalog.courseById.get(step.id);
              if (!next) return null;
              const domain = catalog.domainById.get(next.domains[0]);
              return (
                <Link
                  key={step.id}
                  to={courseHref(step.id, search)}
                  onMouseEnter={() => setEcho(step.id)}
                  onMouseLeave={() => setEcho(null)}
                  onClick={() => requestFocus(step.id)}
                  className="chip hover:text-ink"
                  style={{ borderColor: withAlpha(domain?.color ?? '#ffffff', 0.35) }}
                >
                  {t(`course.${step.id}.title`)}
                  {step.behind ? (
                    <span
                      className="num text-[10px] text-ink-faint"
                      title={t('ui.unlocks.behind', { n: step.behind })}
                    >
                      +{step.behind}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-ink-faint">{t('ui.unlocks.empty')}</p>
        )}
      </section>

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
          href={fixDataUrl(course.id)}
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
