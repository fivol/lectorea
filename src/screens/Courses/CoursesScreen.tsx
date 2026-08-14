import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useT } from '@/i18n';
import { chainAncestors, useCatalog, useFilteredCourses } from '@/lib/catalog';
import { SUGGEST_IN_SLICE, useSearchResults } from '@/lib/search';
import { normalize } from '@shared/search';
import { STAGE_ORDER } from '@shared/schema';
import { courseHref, useCatalogParams } from '@/lib/url';
import { useDocumentMeta } from '@/lib/meta';
import { useIsDesktop, useIsMobile, useEscape } from '@/lib/hooks';
import { clamp, inkOn } from '@/lib/format';
import { useProfile, useResolvedTheme } from '@/store/profile';
import { useUi } from '@/store/ui';
import SearchBox from '@/components/SearchBox';
import ContributeBar from '@/components/ContributeBar';
import GlobalFilters from '@/components/GlobalFilters';
import Dropdown, { ActionRow, Caption, CheckRow, RadioRow } from '@/components/Dropdown';
import ThemeToggle from '@/components/ThemeToggle';
import LangToggle from '@/components/LangToggle';
import ProfileButton from '@/components/ProfileButton';
import { BottomSheet, Cap, Plate, PlateDivider } from '@/components/ui';
import DomainIcon from '@/components/DomainIcon';
import ColumnsView from './ColumnsView';
import CoursePanel from './CoursePanel';
import LegendPopover from './LegendPopover';
import MobileCourseList from './MobileCourseList';

/** Nothing selected, nothing to join up — one set, so the memo below is stable. */
const NO_BRIDGES: Set<string> = new Set();

export default function CoursesScreen() {
  const { courseId } = useParams<{ courseId: string }>();
  const catalog = useCatalog();
  const navigate = useNavigate();
  const params = useCatalogParams();
  const { t } = useT();
  const isMobile = useIsMobile();
  const isDesktop = useIsDesktop();

  const requestFocus = useUi((state) => state.requestFocus);
  const splitRatio = useProfile((state) => state.profile.settings.splitRatio);
  const setSetting = useProfile((state) => state.setSetting);

  const [query, setQuery] = useState('');

  const selected = courseId ? catalog.courseById.get(courseId) ?? null : null;
  const maxStage = useProfile((state) => state.profile.settings.maxStage);
  const visible = useFilteredCourses(params.domains, params.providers, params.lecturers, maxStage);

  /**
   * What this screen is, as far as a tab, a shared link and a search result are
   * concerned: the open course if there is one, the field of knowledge if the
   * filter is on exactly one, and the whole catalogue otherwise. A filter on
   * two fields, or on a university, is a way of looking at the columns rather
   * than a place — it keeps the name of the page it is looking at.
   */
  const field = !selected && params.domains.length === 1 ? params.domains[0] : null;
  const courseName = selected ? t(`course.${selected.id}.title`) : '';
  const pageTitle = selected
    ? selected.playlistCount
      ? t('seo.course.title', { title: courseName })
      : t('seo.course.titlePlain', { title: courseName })
    : field
      ? t('seo.domain.title', { title: t(`domain.${field}.title`) })
      : t('seo.courses.title');
  useDocumentMeta(
    pageTitle,
    selected ? t(`course.${selected.id}.desc`) : field ? t(`domain.${field}.desc`) : t('app.tagline'),
    selected ? `courses/${selected.id}` : field ? `courses?domain=${field}` : 'courses'
  );

  /*
   * Whoever is here has already picked a field, a stage, a university — the
   * question is no longer «what is there», it is «what is there in this». So
   * the field offers this slice before anything is typed, and the largest
   * fields of knowledge overall, which is what the map opens with, stay on the
   * map. Typing still reaches the whole catalogue, filter or no filter.
   */
  const results = useSearchResults(query, { kinds: SUGGEST_IN_SLICE, courses: visible });

  /**
   * Courses from outside the filter that the reader has opened, in the order
   * they were opened.
   *
   * Following «что откроет дальше» out of the current field used to show the
   * course you had just clicked and quietly drop the one before it, so walking
   * two steps along a chain left you with a single foreign card and no way back
   * to the last one. They accumulate instead: an excursion out of the filter is
   * one trail, not a series of unrelated visits.
   *
   * The whole trail ends the moment the selection is back inside the filter or
   * gone altogether — these cards are guests of a selection, and without it
   * they are simply courses the filter says should not be here.
   */
  const [guests, setGuests] = useState<string[]>([]);

  useEffect(() => {
    setGuests((current) => {
      if (!selected || visible.has(selected.id)) return current.length ? [] : current;
      // A filter change can take a guest in — then it is no longer a guest but
      // an ordinary card, and the trail must not keep a second claim on it.
      const kept = current.filter((id) => id !== selected.id && !visible.has(id));
      const next = [...kept, selected.id];
      const same =
        next.length === current.length && next.every((id, index) => id === current[index]);
      return same ? current : next;
    });
  }, [selected, visible]);

  /**
   * The trail as it stands this render. The selection is in it directly rather
   * than waiting for the effect above, or the card would land a frame late —
   * one frame in which the course you just clicked is not on the canvas at all.
   */
  const guestIds = useMemo(() => {
    const ids = new Set(guests.filter((id) => !visible.has(id)));
    if (selected && !visible.has(selected.id)) ids.add(selected.id);
    return ids;
  }, [guests, visible, selected]);

  /**
   * The prerequisites the chain would otherwise be missing — every one of them.
   *
   * The trail above is about where the reader has been; this is about whether
   * what is on screen can be read at all. A filter that hides a course the
   * selection stands on leaves the chain drawn short: the columns stop at the
   * edge of the field while the panel goes on naming what is not there.
   *
   * Recomputed per selection rather than accumulated: these cards are here to
   * carry a particular chain, and the moment that chain is no longer the one
   * being read they have no claim on the columns.
   */
  const borrowed = useMemo(() => {
    if (!selected) return NO_BRIDGES;
    const canvas = guestIds.size ? new Set([...visible, ...guestIds]) : visible;
    return chainAncestors(catalog, selected.id, canvas);
  }, [catalog, selected, visible, guestIds]);

  const onCanvas = useMemo(() => {
    if (!guestIds.size && !borrowed.size) return visible;
    return new Set([...visible, ...guestIds, ...borrowed]);
  }, [visible, guestIds, borrowed]);

  /**
   * Every card standing in a column the filter did not put it in — the trail
   * and the borrowed prerequisites alike. Both are foreign to the filter, so
   * both name the field they came from.
   */
  const outsiders = useMemo(() => {
    if (!borrowed.size) return guestIds;
    return new Set([...guestIds, ...borrowed]);
  }, [guestIds, borrowed]);

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

  /**
   * How the panel is shown, by width. Desktop splits the screen and lets the
   * ratio be dragged; a tablet is too narrow for that — half of 1024px is
   * neither a readable panel nor a usable map — so it gets a drawer instead.
   */
  const split = Boolean(selected) && isDesktop;
  const drawer = Boolean(selected) && !isMobile && !isDesktop;

  // Escape backs out of the panel at every width, not only on the phone.
  useEscape(Boolean(selected), () => navigate(`/courses${params.search}`));

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
    () => catalog.courses.filter((course) => onCanvas.has(course.id)),
    [catalog.courses, onCanvas]
  );

  return (
    <div className="flex h-full flex-col">
      {/*
        Two rows until the whole toolbar genuinely fits on one — and the two are
        decided rather than left to the wrap: chrome above, filters below.
        Wrapping put the last filter and the corner plate on the same line with a
        hole between them, and the line moved every time a label changed length.
      */}
      <header className="z-30 flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2 sm:px-3">
        {/* The way back is set like the switch it came from — same plate, same
            spaced caps, so the two screens read as two views and not as two
            sites. It names what waits there — the fields — rather than the
            drawing it is drawn as: «Карта» and «Список» are the same shelf seen
            twice, and which of the two the reader left by is their business,
            not a thing the corner has to keep score of.

            With no room for the word, the plate closes up around the arrow
            instead of keeping the width the word would have had. */}
        <Cap
          to="/"
          icon="arrow-left"
          ariaLabel={t('ui.nav.backTo.domains')}
          label={<span className="hidden sm:inline">{t('ui.nav.backTo.domains')}</span>}
          className="aspect-square px-0 sm:aspect-auto sm:px-3.5"
        />

        {/* No breadcrumb trail: with «Области» already on the left and the
            domain filter naming the field it leads to, the path repeated both
            of them and left the row too loud to read at a glance.

            Below `xl` the three of them are a strip of their own that scrolls
            sideways: the labels are the values, so their widths change as the
            filters are set, and a row that reflows under you is a different
            toolbar every time. `xl` is where the back, the filters, the search
            field and the plate genuinely fit on one line — there `contents`
            takes this wrapper back out of the layout and they are members of
            the header row again. */}
        <div
          className="scroll-x order-last -mx-4 flex w-full items-center gap-2 px-4
                     [&>*]:shrink-0 sm:-mx-3 sm:px-3 xl:contents"
        >
          <StageFilter />
          <DomainFilter />
          <ProviderFilter />
        </div>

        <div className="ml-auto flex min-w-0 items-center gap-2">
          <SearchBox
            query={query}
            onQueryChange={setQuery}
            results={results}
            variant="compact"
            className="w-40 sm:w-64"
          />
          {/* The same plate as on the map, so crossing between the two screens
              does not change what the corner of the window is. */}
          <Plate row>
            <LangToggle />
            <ThemeToggle />
            <PlateDivider />
            <ProfileButton />
          </Plate>
        </div>

        {/* Under the filters it belongs to, at either width — which on a phone
            it only is if it is ordered there too, the strip above having left
            the flow. */}
        <GlobalFilters className="order-last w-full" />
      </header>

      {isMobile ? (
        <>
          {/* The phone list carries the same quiet signalling as the columns —
              a star, a tick, a count — so it gets the same legend, minus the
              rules that only exist in the graph. */}
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2
                          text-xs text-ink-faint">
            <span className="min-w-0 flex-1">{t('ui.mobile.legend')}</span>
            <LegendPopover variant="list" />
          </div>
          <main className="min-h-0 flex-1 overflow-y-auto">
            <MobileCourseList
              courses={mobileCourses}
              selectedId={selected?.id ?? null}
              onSelect={onSelect}
            />
          </main>
          {/*
            The card comes up over the list rather than replacing it, and stops
            part-way: the row it was opened from stays in sight, which is what
            makes it a card about that course rather than a new screen. Pulled
            up it fills the phone; pushed down it goes away. The sheet owns the
            scrolling — see `scroll` on the panel.
          */}
          {selected ? (
            <BottomSheet
              label={t(`course.${selected.id}.title`)}
              closeLabel={t('ui.common.close')}
              peek={0.62}
              contentKey={selected.id}
              onClose={onDeselect}
            >
              <CoursePanel
                course={selected}
                search={params.search}
                scroll={false}
              />
            </BottomSheet>
          ) : null}
        </>
      ) : (
        /* With nothing selected there is nothing to say, so the panel and its
           splitter are gone entirely and the columns get the whole width. */
        <div ref={splitRef} className="relative flex min-h-0 flex-1">
          <div
            style={split ? { width: `${splitRatio * 100}%` } : undefined}
            className={split ? 'min-w-0' : 'min-w-0 flex-1'}
          >
            <div className="flex h-full min-h-0 flex-col">
              {/* Selecting a course dims most of the screen, and a line that
                  still explains the columns leaves that unexplained — so the
                  legend answers the question actually on screen. */}
              {/* A div, not a p: the legend popover it anchors is a dialog. */}
              <div className="relative z-20 flex shrink-0 items-center gap-2 border-b border-line
                              px-5 py-2 text-xs text-ink-faint">
                <span className="min-w-0 flex-1">
                  {selected
                    ? t('ui.column.legendSelected', { course: t(`course.${selected.id}.title`) })
                    : t('ui.column.legend')}
                </span>
                <LegendPopover />
              </div>
              <div className="min-h-0 flex-1">
                <ColumnsView
                  courses={catalog.courses}
                  visible={onCanvas}
                  guests={outsiders}
                  selectedId={selected?.id ?? null}
                  onSelect={onSelect}
                  onDeselect={onDeselect}
                />
              </div>
            </div>
          </div>

          {split ? (
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
                  course={selected!}
                  search={params.search}
                    onClose={onDeselect}
                />
              </aside>
            </>
          ) : null}

          {/*
            On a tablet the split leaves both halves too narrow to be either a
            map or a panel, so the panel comes over the top instead and the
            columns keep their full width underneath.
          */}
          {drawer ? (
            <>
              <div
                className="fade-only absolute inset-0 z-40 animate-fade-in bg-overlay"
                onClick={onDeselect}
                aria-hidden="true"
              />
              <aside
                className="absolute inset-y-0 right-0 z-40 w-[420px] max-w-full animate-slide-in-right
                           overflow-hidden border-l border-line bg-surface shadow-[var(--shadow-modal)]"
              >
                <CoursePanel
                  course={selected!}
                  search={params.search}
                    onClose={onDeselect}
                />
              </aside>
            </>
          ) : null}
        </div>
      )}

      {/*
        The columns are the screen where a gap is actually noticed — a field
        with four cards in it, a course whose prerequisites are plainly wrong.
        The map has the same bar, so crossing between the two does not lose the
        one line saying the catalogue can be corrected.
      */}
      <ContributeBar>{t('ui.footer.contributeCourses')}</ContributeBar>
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
  const scheme = useResolvedTheme();
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

  // Narrower on a phone: the label is the value, and two filters showing their
  // values beat one filter showing all of its and pushing the other off the
  // strip.
  return (
    <Dropdown
      label={<span className="max-w-[140px] truncate sm:max-w-[210px]">{label}</span>}
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
            <DomainIcon domainId={domain.id} size={15} style={{ color: inkOn(domain.color, scheme) }} />
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

  // Narrower on a phone: the label is the value, and two filters showing their
  // values beat one filter showing all of its and pushing the other off the
  // strip.
  return (
    <Dropdown
      label={<span className="max-w-[140px] truncate sm:max-w-[210px]">{label}</span>}
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

