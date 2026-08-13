import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { useSearchResults } from '@/lib/search';
import { useCatalogParams } from '@/lib/url';
import { useIsMobile, useIsPortrait } from '@/lib/hooks';
import { useMapView, useUi } from '@/store/ui';
import SearchBox, { SuggestCourse } from '@/components/SearchBox';
import ContributeBar from '@/components/ContributeBar';
import GlobalFilters from '@/components/GlobalFilters';
import ThemeToggle from '@/components/ThemeToggle';
import LangToggle from '@/components/LangToggle';
import ViewSwitch from '@/components/ViewSwitch';
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
            at the foot of the screen instead; see below. */}
        <div className="flex items-center gap-2">
          {isMobile ? null : <ViewSwitch value={mapView} onChange={setMapView} />}
          <Plate row>
            <LangToggle />
            <ThemeToggle />
            <PlateDivider />
            <ProfileButton label />
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
        <div className="pointer-events-auto w-full max-w-xl">
          <SearchBox
            query={query}
            onQueryChange={setQuery}
            results={results}
            variant={showMap ? 'floating' : 'inline'}
          />
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
      */}
      {showSummary ? (
        <div className="pointer-events-none absolute right-4 top-[4.5rem] z-30 hidden sm:right-6 xl:block">
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

          `sticky` rather than `fixed`, so that in the blocks view it rides the
          bottom of the scrolling column instead of standing over the middle of
          a card. The zero-height row is what keeps it out of the flow: the grid
          under it does not have to leave a gap for something that floats.

          Over the map the contribute line comes with it, as the last thing at
          the foot of the screen — see the footer below for why it is up here
          and not down there.
        */}
        {isMobile || showSummary ? (
          <div
            /* Clear of the legend written across the foot of the drawing —
               which only exists on the windows wide enough to have room for
               it, and is exactly what the phone gives up to keep the map
               running to the bottom edge. */
            className="pointer-events-none sticky bottom-0 z-30 flex h-0 items-end justify-center
                       pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-12"
          >
            <div className="flex flex-col items-center gap-1.5">
              {/* Where the corner card cannot fit. At the foot of the screen
                  rather than the top: it is the one thing here that is pressed
                  rather than read, and on a phone that is the band a thumb
                  reaches without the hand moving. */}
              {showSummary ? (
                <ProfileSummary
                  variant="bar"
                  className="pointer-events-auto shadow-[var(--shadow-pop)] xl:hidden"
                />
              ) : null}
              {isMobile ? (
                <ViewSwitch
                  large
                  value={mapView}
                  onChange={setMapView}
                  className="pointer-events-auto shadow-[var(--shadow-pop)]"
                />
              ) : null}
              {isMobile && showMap ? (
                <ContributeBar floating>{t('ui.footer.contribute')}</ContributeBar>
              ) : null}
            </div>
          </div>
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
      {isMobile && showMap ? null : <ContributeBar>{t('ui.footer.contribute')}</ContributeBar>}
    </div>
  );
}

