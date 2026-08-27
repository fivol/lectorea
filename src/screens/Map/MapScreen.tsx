import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { useSearchResults } from '@/lib/search';
import { useCatalogParams } from '@/lib/url';
import { useDocumentMeta } from '@/lib/meta';
import { useIsMobile, useIsPortrait, useMeasuredVar } from '@/lib/hooks';
import { useMapView, useUi } from '@/store/ui';
import SearchBox, { SuggestCourse } from '@/components/SearchBox';
import ContributeBar from '@/components/ContributeBar';
import FloatingFoot from '@/components/FloatingFoot';
import GlobalFilters from '@/components/GlobalFilters';
import ThemeToggle from '@/components/ThemeToggle';
import LangToggle from '@/components/LangToggle';
import ViewSwitch, { ViewToggle } from '@/components/ViewSwitch';
import ProfileButton from '@/components/ProfileButton';
import ProfileSummary, { useHighlights } from '@/components/ProfileSummary';
import { Plate, PlateDivider } from '@/components/ui';
import MapView, { MAP_SEA } from './MapView';
import BlocksView from './BlocksView';

export default function MapScreen() {
  const catalog = useCatalog();
  const { t } = useT();
  const params = useCatalogParams();
  const isMobile = useIsMobile();

  const mapView = useMapView();
  const setMapView = useUi((state) => state.setMapView);

  const [query, setQuery] = useState('');
  const results = useSearchResults(query);

  // The front page is the catalogue itself, filters and all: a view of the map
  // with two universities ticked is the same page, not one worth its own entry.
  useDocumentMeta(t('app.documentTitle'), t('app.tagline'), '');

  /**
   * With a global filter on, territories that filter leaves nothing in are
   * dimmed. `providers.json` and `lecturers.json` both carry the domain list
   * precisely so this needs no playlist loading at all.
   *
   * Two filters on means both have to admit the territory — the same AND the
   * columns and the playlist list apply.
   */
  const allowed = useMemo(() => {
    const sets: Array<Set<string>> = [];
    if (params.providers.length) {
      sets.push(
        new Set(params.providers.flatMap((id) => catalog.providers[id]?.domainIds ?? []))
      );
    }
    if (params.lecturers.length) {
      sets.push(
        new Set(params.lecturers.flatMap((name) => catalog.lecturers[name]?.domainIds ?? []))
      );
    }
    if (!sets.length) return null;
    return sets.reduce((kept, next) => new Set([...kept].filter((id) => next.has(id))));
  }, [catalog, params.providers, params.lecturers]);

  const showMap = mapView === 'map';

  /**
   * Whether the reader has a past here worth putting on the front page.
   *
   * The avatar stays in the corner either way. The summary is a shortcut into
   * the profile, not a replacement for the door to it: two ways in cost nothing
   * next to a reader looking for the button where it has always been.
   */
  const showSummary = useHighlights().any && showMap;

  /**
   * Which drawing of the world the window is the right shape for.
   *
   * Decided here rather than inside the map because it is a fact about the
   * window, and it is also the key the map is remounted on: the two files are
   * different worlds, and carrying a reader's zoom from one into the other
   * would land them somewhere else entirely.
   */
  const variant = useIsPortrait() ? 'portrait' : 'wide';

  /** The right-hand column of chrome is as wide as the header's controls. */
  const rail = useMeasuredVar<HTMLDivElement>('rail');

  return (
    /*
      In map mode the sea is the page, header and footer included — so the whole
      screen takes the sea's colour and, with `map-surface`, a palette that works
      on top of it. Both are theme colours, so switching to the dark theme sails
      the whole screen into night without this component knowing anything about
      it.
    */
    <div
      className={`flex h-full flex-col ${showMap ? 'map-surface' : ''}`}
      style={showMap ? { background: MAP_SEA } : undefined}
    >
      {/*
        The header is chrome, not content — it never scrolls away, and it looks
        the same the whole time: on the blocks list it sits above the grid in
        the column, at one size, so nothing in it moves or disappears as the
        cards go past.

        Over the map it is lifted out of the column entirely and floats. The
        drawing then runs the full height of the window and the sea carries on
        behind the wordmark instead of stopping at a band of flat colour — which
        is what tells a reader the header is lying on the map rather than
        holding it down, and what lets the land slide under it when the map is
        dragged.
      */}
      <header
        className={`z-30 flex items-start justify-between gap-4 px-4 pt-4 sm:px-6
                    ${showMap ? 'absolute inset-x-0 top-0' : 'relative'}`}
      >
        {/* Over open water and over a continent alike, so the lettering that
            has no plate under it carries the same halo the map's own names do. */}
        <div className={`flex items-baseline gap-3 ${showMap ? 'over-map' : ''}`}>
          {/* The wordmark is the way home, as it is on every site — and home
              here is the map: from a filtered or searched view, and from the
              blocks, it leads back to the clean drawing. The way back from the
              columns is the other half of that pair: it returns to whichever
              view you left, this one always to the same place. */}
          <h1 className="font-display text-xl tracking-tight">
            <Link
              to="/"
              onClick={() => setMapView('map')}
              className="rounded transition-colors hover:text-accent"
            >
              {t('app.title')}
            </Link>
          </h1>
          <p className="hidden text-xs text-ink-faint lg:block">{t('app.tagline')}</p>
        </div>

        {/* Two plates rather than four buttons: what you are looking at on the
            left, and who is looking on the right.

            The left one is not in this row on a phone — there is no room for it
            beside the wordmark, and a switch that decides what the whole screen
            is belongs under the thumb rather than in the far corner. It floats
            at the foot of the screen instead; see below.

            This row is the right-hand edge of the screen's chrome, so it is
            also what everything floating below it is measured against — it
            publishes its width as `--rail`; see the corner card. */}
        <div ref={rail} className="flex items-center gap-2">
          {/* Two plates and no more. How this place is drawn on the left, who is
              looking on the right — and the way to the desk is the disc rather
              than a third pill saying «Обучение», which beside these two read
              as one row of near-identical switches a reader has to spell out
              before they can tell which is which.

              Neither is in this row on a phone: the places are a bar under the
              thumb, and the map/list toggle rides beside the search field where
              it is part of the screen it changes. */}
          {isMobile ? null : <ViewSwitch value={mapView} onChange={setMapView} />}
          <Plate row>
            <LangToggle />
            <ThemeToggle />
            {isMobile ? null : (
              <>
                <PlateDivider />
                <ProfileButton label />
              </>
            )}
          </Plate>
        </div>
      </header>

      {/*
        The search field floats over the map with a blur behind it rather than
        being nailed to an edge — except on mobile, where a floating element
        just gets in the way of the content.

        Over the list it keeps a band of canvas under it: the cards scroll to
        the top edge of what is below, and with the field sitting flush on that
        edge a heading was cut through the middle a pixel under the pill, which
        reads as a fault rather than as a list carrying on.
      */}
      <div
        className={
          showMap
            ? 'pointer-events-none absolute inset-x-0 top-[72px] z-30 flex flex-col items-center gap-2 px-4'
            : 'z-30 flex flex-col items-center gap-2 px-4 py-3 sm:px-6'
        }
      >
        <div className="pointer-events-auto flex w-full max-w-xl items-center gap-2">
          <div className="min-w-0 flex-1">
            <SearchBox
              query={query}
              onQueryChange={setQuery}
              results={results}
              variant={showMap ? 'floating' : 'inline'}
            />
          </div>
          {/* One glyph rather than the two-word switch, and in the row that is
              already there rather than in a row of its own: the phone's top was
              three bands deep — wordmark, field, switch — over a drawing whose
              names start at the third of them. Like the theme and the language
              buttons it shows where the press *leads* rather than where you
              are, which is what makes one glyph enough. */}
          {isMobile ? (
            <ViewToggle value={mapView} onChange={setMapView} className="shrink-0" />
          ) : null}
        </div>
        <GlobalFilters className="pointer-events-auto justify-center" />
        {query.trim() && results.empty ? (
          <p
            className="glass pointer-events-auto flex items-center gap-2 rounded-full px-3 py-1
                       text-xs text-ink-faint backdrop-blur"
          >
            {t('ui.search.empty')}
            <SuggestCourse query={query} />
          </p>
        ) : null}
      </div>

      {/*
        Over the map, in the corner the avatar was in — under the header plate
        and clear of the search column, which is why it waits for a window wide
        enough to hold all three across. Narrower windows get the same thing as
        a bar at the foot of the screen; see the stack below.

        Exactly as wide as the row of controls above it, rather than a width of
        its own: two plates stacked in the same corner are one piece of chrome
        to look at, and a card that stops short of the switch above it reads as
        a third edge in a corner that only has two. The width is measured rather
        than written down — the row is as wide as its words, which change with
        the language — and the `19.5rem` is only what to be before the first
        measurement lands.
      */}
      {showSummary ? (
        <div
          className="pointer-events-none absolute right-4 top-[4.5rem] z-30 hidden
                     w-[var(--rail,19.5rem)] min-w-[19.5rem] sm:right-6 xl:block"
        >
          <ProfileSummary variant="card" className="pointer-events-auto" />
        </div>
      ) : null}

      {/*
        In map mode this is the whole window: no padding held back for the
        header, because the header is floating over it and the drawing is meant
        to pass underneath. What the map keeps clear of the chrome it does
        itself, by fitting the land to the part of the window nothing is
        standing on — see `CHROME` in `MapView`.

        The sea's own colour underneath, still, for the moment before the file
        has loaded and for the hairline the drawing cannot be expected to cover
        exactly.

        The map is moved rather than scrolled — it answers a wheel itself, and a
        scroll container around it would take the two-finger swipe that is meant
        to carry the drawing.
      */}
      <main
        className={`relative min-h-0 flex-1 ${showMap ? 'overflow-hidden' : 'overflow-auto'}`}
        style={showMap ? { background: MAP_SEA } : undefined}
      >
        {showMap ? (
          <MapView
            // The two maps are two worlds. Remounted rather than reloaded, so a
            // reader who turns the phone gets the other one fitted to the
            // window rather than the last one's zoom applied to it.
            key={variant}
            variant={variant}
            matched={results.matchedDomains}
            searchActive={Boolean(query.trim())}
            allowed={allowed}
          />
        ) : (
          <BlocksView
            matched={results.matchedDomains}
            searchActive={Boolean(query.trim())}
            allowed={allowed}
          />
        )}

        {/*
          The switch on a phone: one control, always in the same place, in the
          band a thumb reaches without the hand moving. It floats over both
          views rather than living inside either — what it says is "the same
          catalogue, drawn the other way", and a control that moved between the
          two would be saying they are two screens.

          Over the map the contribute line comes with it, as the last thing at
          the foot of the screen — see the footer below for why it is up here
          and not down there.

          What the stack costs the window is measured rather than assumed — see
          `FloatingFoot`. The map's controls and the map's own fitting both
          stand clear of whatever ends up in here, which is not the same stack
          on every screen or for every reader.
        */}
        {/* Between the phone's window and the wide one: a window too narrow for
            the corner card and too wide for the bar of places still has a
            reader who stopped somewhere. Nothing here on a phone — the desk is
            one of the two tabs the app draws over every screen, and the map's
            own foot is left to the map. */}
        {showSummary && !isMobile ? (
          <FloatingFoot>
            <ProfileSummary
              variant="bar"
              className="pointer-events-auto shadow-[var(--shadow-pop)] xl:hidden"
            />
          </FloatingFoot>
        ) : null}
      </main>

      {/*
        The only place in the app that can offer a domain: nothing on screen is
        one, so there is nothing to hang a contextual link on. A playlist has
        its course panel and a missing course has the search — this covers the
        rest, and says the catalogue is written by the people reading it rather
        than merely licensed to them.

        A row of its own everywhere except over the map on a phone, where it
        has already been drawn above, floating under the view switch. Its own
        row there costs the map a strip of flat colour along the bottom of a
        drawing that otherwise runs to the edge of the screen — which is a lot
        to charge for one line of small print, and the whole of what a phone has
        to spare. Wider windows keep the row: the legend is written across the
        foot of the drawing on those, and a line floating over it would be two
        sentences in the same place.
      */}
      {/* A row of its own on a wide window, and nothing at all on a phone:
          over the map it would be a strip of flat colour under a drawing that
          runs to the edge, and over the list it would be a band the navigation
          then has to stand clear of — which is how the bar came to sit at two
          different heights on two tabs. The list carries the line inside its
          own scroller instead; see `BlocksView`. */}
      {isMobile ? null : <ContributeBar>{t('ui.footer.contribute')}</ContributeBar>}
    </div>
  );
}

