import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useT } from '@/i18n';
import { pathTo, useCatalog, useFilteredCourses } from '@/lib/catalog';
import { useSearchResults } from '@/lib/search';
import { normalize } from '@shared/search';
import { STAGE_ORDER } from '@shared/schema';
import { courseHref, useCatalogParams } from '@/lib/url';
import { useIsMobile, useEscape } from '@/lib/hooks';
import { clamp } from '@/lib/format';
import { useProfile } from '@/store/profile';
import { useUi } from '@/store/ui';
import SearchBox from '@/components/SearchBox';
import GlobalFilters from '@/components/GlobalFilters';
import Dropdown, { ActionRow, Caption, CheckRow, RadioRow } from '@/components/Dropdown';
import Icon from '@/components/Icon';
import DomainIcon from '@/components/DomainIcon';
import ColumnsView from './ColumnsView';
import CoursePanel from './CoursePanel';
import MobileCourseList from './MobileCourseList';
import PrerequisiteStrip from './PrerequisiteStrip';

export default function CoursesScreen() {
  const { courseId } = useParams<{ courseId: string }>();
  const catalog = useCatalog();
  const navigate = useNavigate();
  const params = useCatalogParams();
  const { t } = useT();
  const isMobile = useIsMobile();

  const openProfile = useUi((state) => state.openProfile);
  const requestFocus = useUi((state) => state.requestFocus);
  const splitRatio = useProfile((state) => state.profile.settings.splitRatio);
  const setSetting = useProfile((state) => state.setSetting);

  const [query, setQuery] = useState('');
  const results = useSearchResults(query);

  const selected = courseId ? catalog.courseById.get(courseId) ?? null : null;
  const maxStage = useProfile((state) => state.profile.settings.maxStage);
  const visible = useFilteredCourses(params.domains, params.providers, maxStage);

  const path = useMemo(
    () => (selected ? pathTo(catalog, selected.id) : []),
    [catalog, selected]
  );

  /** Courses the path needs but the filter excludes — the panel says so. */
  const pathOutsideFilter = useMemo(
    () => path.filter((step) => !visible.has(step.id)).length,
    [path, visible]
  );

  const visibleWithSelection = useMemo(() => {
    if (!selected || visible.has(selected.id)) return visible;
    const next = new Set(visible);
    next.add(selected.id);
    return next;
  }, [visible, selected]);

  const onSelect = useCallback(
    (id: string) => {
      navigate(courseHref(id, params.search));
      requestFocus(id);
    },
    [navigate, params.search, requestFocus]
  );

  /** Clearing the selection is a navigation, so back still walks the history. */
  const onDeselect = useCallback(
    () => navigate(`/courses${params.search}`),
    [navigate, params.search]
  );

  useEscape(Boolean(selected) && isMobile, () => navigate(`/courses${params.search}`));

  /* ─────────────────────────────  Splitter  ───────────────────────────── */

  const splitRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: PointerEvent): void => {
      const rect = splitRef.current?.getBoundingClientRect();
      if (!rect) return;
      setSetting('splitRatio', clamp((event.clientX - rect.left) / rect.width, 0.3, 0.8));
    };
    const onUp = (): void => setDragging(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [dragging, setSetting]);

  const mobileCourses = useMemo(
    () => catalog.courses.filter((course) => visibleWithSelection.has(course.id)),
    [catalog.courses, visibleWithSelection]
  );

  return (
    <div className="flex h-full flex-col">
      <header className="z-30 flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <Link
          to="/"
          className="btn-ghost flex items-center gap-1.5 rounded px-2 py-1 text-sm"
          aria-label={t('ui.nav.backToMap')}
        >
          <Icon name="arrow-left" size={14} />
          <span className="hidden sm:inline">{t('ui.nav.backToMap')}</span>
        </Link>

        <nav aria-label="breadcrumbs" className="hidden min-w-0 items-center gap-1 text-sm text-ink-faint md:flex">
          <Link to="/" className="hover:text-ink-dim">
            {t('ui.nav.breadcrumbRoot')}
          </Link>
          {selected ? (
            <>
              <span>/</span>
              <Link
                to={`/courses?domain=${encodeURIComponent(selected.domains[0])}`}
                className="hover:text-ink-dim"
              >
                {t(`domain.${selected.domains[0]}.title`)}
              </Link>
              <span>/</span>
              <span className="truncate text-ink">{t(`course.${selected.id}.title`)}</span>
            </>
          ) : params.domains.length === 1 ? (
            <>
              <span>/</span>
              <span className="text-ink">{t(`domain.${params.domains[0]}.title`)}</span>
            </>
          ) : null}
        </nav>

        <StageFilter />
        <DomainFilter />
        <ProviderFilter />

        <div className="ml-auto flex min-w-0 items-center gap-2">
          <SearchBox
            query={query}
            onQueryChange={setQuery}
            results={results}
            className="w-40 sm:w-64"
          />
          <button
            type="button"
            className="btn px-2"
            onClick={openProfile}
            aria-label={t('ui.nav.profile')}
          >
            <Icon name="profile" />
          </button>
        </div>

        <GlobalFilters className="w-full" />
      </header>

      {isMobile ? (
        <>
          <main className="min-h-0 flex-1 overflow-y-auto">
            <MobileCourseList
              courses={mobileCourses}
              selectedId={selected?.id ?? null}
              onSelect={onSelect}
            />
          </main>
          {selected ? (
            <div className="fixed inset-0 z-40 flex flex-col">
              <div
                className="flex-1 bg-black/50"
                onClick={() => navigate(`/courses${params.search}`)}
                aria-hidden="true"
              />
              <div className="animate-slide-in-bottom max-h-[88vh] overflow-hidden rounded-t-2xl border-t border-line bg-surface">
                <div className="flex items-center justify-between border-b border-line px-3 py-2">
                  <span className="h-1 w-10 rounded-full bg-line" aria-hidden="true" />
                  <button
                    type="button"
                    className="btn-ghost rounded p-1"
                    onClick={() => navigate(`/courses${params.search}`)}
                    aria-label={t('ui.common.close')}
                  >
                    <Icon name="close" />
                  </button>
                </div>
                <div className="max-h-[80vh] overflow-y-auto">
                  <CoursePanel
                    course={selected}
                    search={params.search}
                    outsideFilter={pathOutsideFilter}
                  />
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        /* With nothing selected there is nothing to say, so the panel and its
           splitter are gone entirely and the columns get the whole width. */
        <div ref={splitRef} className="flex min-h-0 flex-1">
          <div
            style={selected ? { width: `${splitRatio * 100}%` } : undefined}
            className={selected ? 'min-w-0' : 'min-w-0 flex-1'}
          >
            <div className="flex h-full min-h-0 flex-col">
              {/* Orientation and answer share one slot: the legend explains why
                  the cards are in columns at all, and once a course is picked
                  the question has moved on to what that one needs. */}
              {selected ? (
                <PrerequisiteStrip course={selected} onSelect={onSelect} />
              ) : (
                <p className="shrink-0 border-b border-line px-5 py-2 text-xs text-ink-faint">
                  {t('ui.column.legend')}
                </p>
              )}
              <div className="min-h-0 flex-1">
                <ColumnsView
                  courses={catalog.courses}
                  visible={visibleWithSelection}
                  selectedId={selected?.id ?? null}
                  onSelect={onSelect}
                  onDeselect={onDeselect}
                />
              </div>
            </div>
          </div>

          {selected ? (
            <>
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label={t('ui.a11y.dragSplitter')}
                tabIndex={0}
                onPointerDown={() => setDragging(true)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowLeft') setSetting('splitRatio', clamp(splitRatio - 0.02, 0.3, 0.8));
                  if (event.key === 'ArrowRight') setSetting('splitRatio', clamp(splitRatio + 0.02, 0.3, 0.8));
                }}
                className={`w-1 shrink-0 cursor-col-resize bg-line transition-colors hover:bg-accent
                            ${dragging ? 'bg-accent' : ''}`}
              />

              <aside className="min-w-0 flex-1 border-l border-line bg-surface/40">
                <CoursePanel
                  course={selected}
                  search={params.search}
                  outsideFilter={pathOutsideFilter}
                  onClose={onDeselect}
                />
              </aside>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * "I am in year 11" — everything past that disappears, in every domain and in
 * the next session too, which is why it is a setting rather than a URL
 * parameter. Picking a stage means that stage *and below*: the question is how
 * far someone has got, not which single year they want to look at.
 */
function StageFilter() {
  const { t } = useT();
  const maxStage = useProfile((state) => state.profile.settings.maxStage);
  const setSetting = useProfile((state) => state.setSetting);

  return (
    <Dropdown
      label={maxStage ? t(`ui.stage.${maxStage}`) : t('ui.filter.stage.all')}
      active={Boolean(maxStage)}
    >
      <RadioRow checked={!maxStage} onChange={() => setSetting('maxStage', null)}>
        {t('ui.filter.stage.all')}
      </RadioRow>
      {STAGE_ORDER.map((stage) => (
        <RadioRow
          key={stage}
          checked={maxStage === stage}
          onChange={() => setSetting('maxStage', stage)}
        >
          {t(`ui.stage.${stage}`)}
        </RadioRow>
      ))}
    </Dropdown>
  );
}

/**
 * Names, not a count. "Выбрано: 2" makes you open the menu to find out what you
 * picked, which is the one thing the trigger exists to save you.
 */
function useFilterLabel(): (names: string[], fallback: string) => string {
  const { t } = useT();
  return (names, fallback) => {
    if (!names.length) return fallback;
    if (names.length <= 2) return names.join(', ');
    return `${names.slice(0, 2).join(', ')} ${t('ui.filter.andMore', { n: names.length - 2 })}`;
  };
}

function DomainFilter() {
  const catalog = useCatalog();
  const params = useCatalogParams();
  const { t } = useT();
  const summarise = useFilterLabel();
  const [query, setQuery] = useState('');

  /**
   * Biggest first, so the list is already useful before anything is typed —
   * the map and the blocks view are where the continents are grouped.
   */
  const domains = useMemo(() => {
    const needle = normalize(query);
    return [...catalog.domains]
      .filter((domain) => !needle || normalize(t(`domain.${domain.id}.title`)).includes(needle))
      .sort((a, b) => b.courseCount - a.courseCount || a.id.localeCompare(b.id));
  }, [catalog.domains, query, t]);

  const label = summarise(
    params.domains.map((id) => t(`domain.${id}.title`)),
    t('ui.filter.domain.all')
  );

  return (
    <Dropdown
      label={<span className="max-w-[210px] truncate">{label}</span>}
      active={params.domains.length > 0}
      search={{ value: query, onChange: setQuery, placeholder: t('ui.filter.searchDomain') }}
    >
      <ActionRow onClick={() => params.setDomains([])}>{t('ui.filter.domain.all')}</ActionRow>
      <Caption>{query ? t('ui.filter.found', { n: domains.length }) : t('ui.filter.largest')}</Caption>
      {!domains.length ? (
        <p className="px-2 py-1.5 text-sm text-ink-faint">{t('ui.search.empty')}</p>
      ) : null}
      {domains.map((domain) => (
        <CheckRow
          key={domain.id}
          checked={params.domains.includes(domain.id)}
          onChange={() => params.toggleDomain(domain.id)}
        >
          <span className="flex items-center gap-2">
            {/* The glyph, not a dot: it is the same mark the territory carries
                on the map, so the row is recognisable rather than colour-coded
                — and colour alone is no help to anyone who cannot see it. */}
            <DomainIcon domainId={domain.id} size={15} style={{ color: domain.color }} />
            <span className="min-w-0 flex-1 truncate">{t(`domain.${domain.id}.title`)}</span>
            <span className="num shrink-0 text-[11px] text-ink-faint">{domain.courseCount}</span>
          </span>
        </CheckRow>
      ))}
    </Dropdown>
  );
}

/**
 * Picking a university was only reachable by typing into the search box, which
 * hid it from anyone who did not already know the name they were looking for.
 * Same URL parameter, same behaviour — just visible.
 *
 * Providers with nothing in the catalogue are dropped rather than shown greyed
 * out: the list is long enough already, and a filter that yields nothing is not
 * worth a row.
 */
function ProviderFilter() {
  const catalog = useCatalog();
  const params = useCatalogParams();
  const { t, count } = useT();
  const summarise = useFilterLabel();
  const [query, setQuery] = useState('');

  const providers = useMemo(() => {
    const needle = normalize(query);
    return Object.values(catalog.providers)
      .filter((provider) => provider.playlistCount > 0 || params.providers.includes(provider.id))
      .filter((provider) => !needle || normalize(provider.title).includes(needle))
      .sort((a, b) => b.playlistCount - a.playlistCount || a.title.localeCompare(b.title));
  }, [catalog.providers, params.providers, query]);

  const label = summarise(
    params.providers.map((id) => catalog.providers[id]?.title ?? id),
    t('ui.filter.provider.all')
  );

  return (
    <Dropdown
      label={<span className="max-w-[210px] truncate">{label}</span>}
      active={params.providers.length > 0}
      search={{ value: query, onChange: setQuery, placeholder: t('ui.filter.searchProvider') }}
    >
      <ActionRow onClick={() => params.setProviders([])}>{t('ui.filter.provider.all')}</ActionRow>
      <Caption>{query ? t('ui.filter.found', { n: providers.length }) : t('ui.filter.popular')}</Caption>
      {!providers.length ? (
        <p className="px-2 py-1.5 text-sm text-ink-faint">{t('ui.search.empty')}</p>
      ) : null}
      {providers.map((provider) => (
        <CheckRow
          key={provider.id}
          checked={params.providers.includes(provider.id)}
          onChange={() => params.toggleProvider(provider.id)}
        >
          <span className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate">{provider.title}</span>
            <span className="num shrink-0 text-[11px] text-ink-faint">
              {count(provider.playlistCount, 'playlist')}
            </span>
          </span>
        </CheckRow>
      ))}
    </Dropdown>
  );
}

