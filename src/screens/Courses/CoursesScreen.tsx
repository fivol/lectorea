import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useT } from '@/i18n';
import { track } from '@/lib/analytics';
import { chainAncestors, useCatalog, useFilteredCourses } from '@/lib/catalog';
import { useResumeList, useResumeProgress } from '@/lib/progress';
import { SUGGEST_IN_SLICE, useSearchResults } from '@/lib/search';
import { normalize } from '@shared/search';
import { STAGE_ORDER } from '@shared/schema';
import { columnsHref, courseHref, useCatalogParams, withDomains } from '@/lib/url';
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

import Icon from '@/components/Icon';
import { CountTile } from '@/components/Facts';
import { ResumeCard, ResumeStepper, useResumeCarousel } from '@/components/ResumeCard';
import { BottomSheet, Cap, Chip, IconButton, Plate, PlateDivider } from '@/components/ui';
import DomainIcon from '@/components/DomainIcon';
import ColumnsView from './ColumnsView';
import CoursePanel from './CoursePanel';
import LegendPopover from './LegendPopover';
import MobileCourseList from './MobileCourseList';

/** Nothing selected, nothing to join up — one set, so the memo below is stable. */
const NO_BRIDGES: Set<string> = new Set();

export default function CoursesScreen() {
  const { courseId, domainId } = useParams<{ courseId?: string; domainId?: string }>();
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

  /**
   * Whether anything at all narrows what the columns are showing. The three
   * filters are equal here: «все курсы МИТ» is a slice somebody asked for, and
   * only a screen with none of them set is the one nobody asked for.
   */
  const unfiltered = !params.domains.length && !params.providers.length && !params.lecturers.length;

  /*
   * The columns are always looking at something. Two ways in break that, and
   * both arrive from outside the app — a link somebody shared, a search result:
   *
   * — `/courses` with nothing set draws all 225 cards across nine columns of
   *   every subject at once. It is the one view of the catalogue that answers
   *   no question: too wide to read, and the map exists precisely to choose a
   *   field before the columns are worth opening. It goes back to the map.
   * — `/courses/inorganic-chemistry` opens the right course inside that same
   *   wall. Reached from the search box or the profile the course brings its
   *   own fields along with it (`useCourseSlice`), so the address is the only
   *   way to land on the wide one — and it gets the same treatment, its own
   *   fields rather than the primary one alone, for the reason written there.
   *
   * A field of knowledge that does not exist is the third: `prerender.ts`
   * writes a page per real field and nothing links to any other, so it is a
   * stale link, and the map is a better answer than a screen filtered down to
   * nothing.
   */
  useEffect(() => {
    if (domainId && !catalog.domainById.has(domainId)) {
      navigate('/', { replace: true });
      return;
    }
    if (!unfiltered) return;
    if (!selected) {
      navigate('/', { replace: true });
      return;
    }
    if (selected.domains.length) {
      navigate(courseHref(selected.id, withDomains('', selected.domains)), { replace: true });
    }
  }, [catalog, domainId, navigate, selected, unfiltered]);

  /*
   * A course opened, with the facts a report needs about it beside the id.
   *
   * `page_view` already counts the address; this counts the *course*, and the
   * four extra fields are what make the count answerable: how deep into a
   * subject people actually go, whether an empty course is opened as often as
   * a full one, which fields of knowledge carry the traffic. None of it can be
   * joined up afterwards, because the catalogue a report is read against is a
   * month newer than the day it was collected.
   */
  useEffect(() => {
    if (!selected) return;
    track('course_open', {
      course_id: selected.id,
      domain: selected.domains[0],
      level: selected.level,
      stage: selected.stage,
      playlists: selected.playlistCount,
    });
  }, [selected]);
  const maxStage = useProfile((state) => state.profile.settings.maxStage);
  /** Whether the columns draw the whole chain or the tree it cuts back to. */
  const fullGraph = useProfile((state) => state.profile.settings.fullGraph);
  /** And whether its lines are steps down a lane or one curve card to card. */
  const steppedLines = useProfile((state) => state.profile.settings.steppedLines);
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
  /*
   * The same three cases as the tab's name, without the site on the end of it.
   * A tab says which site it belongs to because it stands next to eleven other
   * tabs; a heading is inside the site already, and «Математика — курсы и
   * видеолекции | Lectorea» is not what this page is called.
   */
  const heading = selected
    ? courseName
    : field
      ? t(`domain.${field}.title`)
      : t('seo.heading.courses');
  useDocumentMeta(
    pageTitle,
    selected ? t(`course.${selected.id}.desc`) : field ? t(`domain.${field}.desc`) : t('app.tagline'),
    // A field of knowledge names itself `/fields/<id>` whichever way it was
    // reached, so the older `/courses?domain=<id>` links point at it rather
    // than competing with it — see `useCatalogParams`.
    selected ? `courses/${selected.id}` : field ? `fields/${field}` : 'courses'
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
   * Everything the selection stands on that the filter is not showing — the
   * whole chain back, not just the first step.
   *
   * The trail above is about where the reader has been; this is about whether
   * what is on screen can be read at all. A filter that hides a course the
   * selection stands on leaves the chain drawn short: the columns stop at the
   * edge of the field while the panel goes on naming what is not there.
   *
   * The closure, not one hop — see `chainAncestors`. Stopping at the direct
   * `deps` only moves the broken end one column left.
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

  /** Everything on the canvas: the filter, the trail, and the chain behind. */
  const settled = useMemo(() => {
    if (!guestIds.size && !borrowed.size) return visible;
    return new Set([...visible, ...guestIds, ...borrowed]);
  }, [visible, guestIds, borrowed]);

  /**
   * What stands on the canvas is decided by the filter and the selection, and
   * by nothing a pointer does.
   *
   * Pointing at a name in the panel used to give the course it names a seat in
   * its column for as long as the pointer was on it. «Открывает путь к» leaves
   * the field almost every time — what a course opens is usually somebody
   * else's subject — so the card was one the filter is not showing, and it was
   * borrowed in, faded into place, and taken out again on mouse-out. As a
   * description of one card that reads well; as a screen it is the columns
   * re-laying themselves out under a pointer that is only crossing the panel on
   * its way somewhere else. A list of eight names is sixteen arrivals and
   * departures, each pushing the column below it up or down, none of them on
   * screen long enough to be read — and each one measured at a 60–115 ms task,
   * which is a stutter under the hand that caused it.
   *
   * So the pointer paints and never moves anything: a card already on the
   * canvas still lifts when its name is pointed at, and the edge to it is still
   * drawn — both are paint over a layout that does not change — and a course
   * the filter is hiding waits for the click that selects it, which brings it
   * in with the whole chain behind it, in one move.
   */
  const onCanvas = settled;

  /**
   * Every card standing in a column the filter did not put it in — the trail
   * and the borrowed prerequisites. Both are foreign to the filter, so both
   * name the field they came from.
   */
  const outsiders = useMemo(
    () => (borrowed.size ? new Set([...guestIds, ...borrowed]) : guestIds),
    [guestIds, borrowed]
  );

  const onSelect = useCallback(
    (id: string) => {
      navigate(courseHref(id, params.search));
      requestFocus(id);
    },
    [navigate, params.search, requestFocus]
  );

  /** Clearing the selection is a navigation, so back still walks the history. */
  const onDeselect = useCallback(
    () => navigate(columnsHref(params.search)),
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
  useEscape(Boolean(selected), () => navigate(columnsHref(params.search)));

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
        The name of the page, once, for whoever cannot see the screen — a
        screen reader arriving at the columns, and a crawler that runs the
        bundle and then looks for what this page is about. It is not drawn:
        the columns say what they are by being columns, and the open course
        already carries its own title in the panel beside them. Without it
        every one of the 264 addresses below `/courses` and `/fields` rendered
        without a single first-level heading, and the only copy of it was in
        the `<noscript>` block that running the bundle throws away.
      */}
      <h1 className="sr-only">{heading}</h1>
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
                {/* Only with a course selected: the curves it governs exist only
                    then, and a switch for something not on screen is a puzzle.
                    It sits here rather than in the panel because it is about the
                    columns — the panel is about the one course in them. */}
                {selected ? (
                  <>
                    <Chip
                      on={fullGraph}
                      icon={fullGraph ? 'check' : undefined}
                      onClick={() => setSetting('fullGraph', !fullGraph)}
                      hint={t('ui.column.fullGraphHint')}
                    >
                      {t('ui.column.fullGraph')}
                    </Chip>
                    <Chip
                      on={steppedLines}
                      icon={steppedLines ? 'check' : undefined}
                      onClick={() => setSetting('steppedLines', !steppedLines)}
                      hint={t('ui.column.steppedHint')}
                    >
                      {t('ui.column.stepped')}
                    </Chip>
                  </>
                ) : null}
                <LegendPopover />
              </div>
              <div className="relative min-h-0 flex-1">
                <ColumnsView
                  courses={catalog.courses}
                  visible={onCanvas}
                  guests={outsiders}
                  selectedId={selected?.id ?? null}
                  onSelect={onSelect}
                  onDeselect={onDeselect}
                />
                {/* Only with nothing selected. A selection is a chain lit up
                    across these columns and a panel naming it, and a plate over
                    the corner of that is one thing too many — the panel carries
                    its own «Продолжить» anyway, and a better one, naming the
                    lecture rather than the recording. */}
                {selected ? null : <FieldProgress within={visible} field={field} />}
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
 * Your own standing in the slice on screen: the front page's card, asked of this
 * field instead of the catalogue.
 *
 * The front page answers «where was I» across everything, because everything is
 * what it is showing. Here the reader has narrowed to химия, and both halves of
 * the card have to narrow with them: the recording offered is the last one
 * opened **in this field**, and the counts are of **these** courses. A card that
 * kept the global numbers under a heading naming the field would be the worst of
 * the two — scoped-looking and not scoped.
 *
 * Hence the heading says which field it is counting. There is no attempt to
 * decline the name into «в Химии»: the catalogue holds «Науки о Земле» and
 * «Компьютерная лингвистика» as well, and a product that guesses at Russian
 * cases gets one of them wrong in public. A separator says the same thing and
 * survives every name and both languages.
 *
 * The three counts are free — course status lives in the profile, and the
 * denominator is the filter's own size — so this costs no download, exactly like
 * the front page's. Lectures and hours in a field are not here for the same
 * reason: they live in the shards, and a card in a corner is not worth three
 * quarters of a megabyte.
 *
 * A plate in the corner rather than a strip in the flow: a strip pushed every
 * column down by its own height on every visit, and the columns are read by
 * scanning down them. Floating, it covers a corner of one column, which is
 * scrolled past rather than lost. The × is the front page's ×, one flag and one
 * meaning — «not this visit» — wherever it is pressed.
 *
 * The press keeps the filters exactly as they are, unlike the front page's,
 * which has to invent a slice to land in. It also asks the columns to scroll the
 * card into view, so what opens has a visible place to have come from.
 */
function FieldProgress({ within, field }: { within: ReadonlySet<string>; field: string | null }) {
  const { t } = useT();
  const catalog = useCatalog();
  const navigate = useNavigate();
  const params = useCatalogParams();
  const requestFocus = useUi((state) => state.requestFocus);
  const hidden = useUi((state) => state.summaryHidden);
  const hideSummary = useUi((state) => state.hideSummary);
  const courses = useProfile((state) => state.profile.courses);
  /* Everything started **in this field** — the arrow leafs through these and no
     further, which is the whole difference from the front page's card. */
  const resumes = useResumeList(within);
  const { current: resume, index, count, prev, next } = useResumeCarousel(resumes);
  const progress = useResumeProgress(resume);

  /* Counted over the filter's own set: a stage or a university filter narrows
     it too, which is right — the question the card answers is «how am I doing
     with what I am looking at». */
  const stats = useMemo(() => {
    let done = 0;
    let going = 0;
    for (const id of within) {
      const status = courses[id]?.status;
      if (status === 'done') done += 1;
      else if (status === 'in_progress') going += 1;
    }
    return { done, going };
  }, [within, courses]);

  // Nothing to continue and nothing behind you in this field: an empty card
  // announcing zeroes over somebody's first visit to химия is a scolding.
  if (hidden || (!resume && !stats.done && !stats.going)) return null;
  const course = resume ? catalog.courseById.get(resume.entry.courseId) : null;

  return (
    /* Held clear of the scrollbars on both edges, and never wider than the
       columns it lies on — a plate cropped by the viewport is a plate with the
       × outside the window. */
    /* Wider than the front page's, which is measured against the row of
       controls above it and has nothing to spare. Here the ceiling is the
       columns, and the extra 56px is what keeps a heading naming a field, the
       arrows that leaf through the offers and a recording naming a term all off
       the ellipsis at once. */
    <div className="pointer-events-none absolute right-3 top-3 z-20 flex w-[23rem]
                    max-w-[calc(100%-1.5rem)] justify-end">
      <div className="plate pointer-events-auto w-full rounded-card p-3">
        <div className="mb-2.5 flex items-center gap-2">
          <span className="profile-disc shrink-0">
            <Icon name="profile" size={14} />
          </span>
          <span className="mono-label min-w-0 flex-1 truncate text-ink-dim">
            {field
              ? t('ui.home.progressIn', { name: t(`domain.${field}.title`) })
              : t('ui.home.progress')}
          </span>
          <ResumeStepper index={index} count={count} onPrev={prev} onNext={next} />
          <IconButton
            icon="close"
            iconSize={14}
            label={t('ui.home.hide')}
            className="shrink-0"
            onClick={hideSummary}
          />
        </div>

        <div className="space-y-2.5">
          {resume ? (
            <ResumeCard
              videoId={resume.lastVideoId}
              title={resume.entry.title}
              subtitle={course ? t(`course.${course.id}.title`) : resume.entry.courseId}
              progress={progress}
              onClick={() => {
                const query = new URLSearchParams(params.search);
                query.set('playlist', resume.entry.id);
                navigate(courseHref(resume.entry.courseId, `?${query.toString()}`));
                requestFocus(resume.entry.courseId);
              }}
            />
          ) : null}

          {/* Two, not three. «Всего курсов» was the denominator the other two
              are shares of, and it was also the one number here that is about
              the catalogue rather than about the reader — on a card headed
              «ваш прогресс» that is the odd one out. How many courses the field
              holds is on the map, on the filter row and in the columns being
              counted. */}
          <div className="flex items-stretch gap-2">
            <CountTile value={stats.done} label={t('ui.home.stats.done')} />
            <CountTile value={stats.going} label={t('ui.home.stats.going')} />
          </div>
        </div>
      </div>
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

