import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useT } from '@/i18n';
import { useCatalog, useFilteredCourses } from '@/lib/catalog';
import { useSearchResults } from '@/lib/search';
import { courseHref, useCatalogParams } from '@/lib/url';
import { useIsMobile, useEscape } from '@/lib/hooks';
import { clamp } from '@/lib/format';
import { useProfile } from '@/store/profile';
import { useUi } from '@/store/ui';
import SearchBox from '@/components/SearchBox';
import GlobalFilters from '@/components/GlobalFilters';
import Dropdown, { CheckRow } from '@/components/Dropdown';
import Icon from '@/components/Icon';
import GraphCanvas from './GraphCanvas';
import CoursePanel from './CoursePanel';
import MobileCourseList from './MobileCourseList';

export default function GraphScreen() {
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
  const { visible, dimmed } = useFilteredCourses(params.domains, params.providers);

  /**
   * The path punches through the domain filter: when a prerequisite of the
   * selected course falls outside the filter it still shows up, dimmed, instead
   * of the arrow running into nothing.
   */
  const dimmedWithPath = useMemo(() => {
    if (!selected) return dimmed;
    const next = new Set(dimmed);
    for (const id of selected.reachUp) if (!visible.has(id)) next.add(id);
    next.delete(selected.id);
    return next;
  }, [dimmed, visible, selected]);

  /** Courses the path needs but the filter excludes — the panel says so. */
  const pathOutsideFilter = useMemo(
    () => (selected ? selected.reachUp.filter((id) => !visible.has(id)).length : 0),
    [selected, visible]
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

        <DomainFilter />

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
        <div ref={splitRef} className="flex min-h-0 flex-1">
          <div style={{ width: `${splitRatio * 100}%` }} className="min-w-0">
            <GraphCanvas
              courses={catalog.courses}
              visible={visibleWithSelection}
              dimmed={dimmedWithPath}
              selectedId={selected?.id ?? null}
              onSelect={onSelect}
            />
          </div>

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
            {selected ? (
              <CoursePanel
                course={selected}
                search={params.search}
                outsideFilter={pathOutsideFilter}
              />
            ) : (
              <EmptyPanel />
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function DomainFilter() {
  const catalog = useCatalog();
  const params = useCatalogParams();
  const { t } = useT();

  const label = params.domains.length
    ? t('ui.filter.domain.selected', { n: params.domains.length })
    : t('ui.filter.domain.all');

  return (
    <Dropdown label={label} active={params.domains.length > 0}>
      <button
        type="button"
        className="mb-1 w-full rounded px-2 py-1 text-left text-xs text-ink-faint hover:bg-surface-2"
        onClick={() => params.setDomains([])}
      >
        {t('ui.filter.domain.all')}
      </button>
      {catalog.domains.map((domain) => (
        <CheckRow
          key={domain.id}
          checked={params.domains.includes(domain.id)}
          onChange={() => params.toggleDomain(domain.id)}
        >
          <span className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: domain.color }} />
            {t(`domain.${domain.id}.title`)}
          </span>
        </CheckRow>
      ))}
    </Dropdown>
  );
}

function EmptyPanel() {
  const { t } = useT();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <Icon name="chevron-left" size={20} className="text-ink-faint" />
      <p className="text-sm text-ink-faint">{t('ui.a11y.selectCourse')}</p>
      <p className="text-xs text-ink-faint">{t('ui.graph.hint')}</p>
    </div>
  );
}
