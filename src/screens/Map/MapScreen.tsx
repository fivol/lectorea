import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { useSearchResults } from '@/lib/search';
import { useCatalogParams } from '@/lib/url';
import { useIsMobile } from '@/lib/hooks';
import { useMapView, useUi } from '@/store/ui';
import SearchBox, { SuggestCourse } from '@/components/SearchBox';
import ContributeBar from '@/components/ContributeBar';
import GlobalFilters from '@/components/GlobalFilters';
import ThemeToggle from '@/components/ThemeToggle';
import LangToggle from '@/components/LangToggle';
import ViewSwitch from '@/components/ViewSwitch';
import ProfileButton from '@/components/ProfileButton';
import { Plate, PlateDivider } from '@/components/ui';
import MapView, { MAP_SEA } from './MapView';
import BlocksView from './BlocksView';

export default function MapScreen() {
  const catalog = useCatalog();
  const { t } = useT();
  const params = useCatalogParams();
  const isMobile = useIsMobile();
  const [scrolled, setScrolled] = useState(false);

  const mapView = useMapView();
  const setMapView = useUi((state) => state.setMapView);

  const [query, setQuery] = useState('');
  const results = useSearchResults(query);

  /**
   * With a provider filter on, territories with no materials from that provider
   * are dimmed. `providers.json` carries the domain list precisely so this
   * needs no playlist loading at all.
   */
  const allowed = useMemo(() => {
    if (!params.providers.length) return null;
    const set = new Set<string>();
    for (const id of params.providers) {
      for (const domain of catalog.providers[id]?.domainIds ?? []) set.add(domain);
    }
    return set;
  }, [catalog, params.providers]);

  const showMap = mapView === 'map';
  const compact = !showMap && scrolled;

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
        The header is chrome, not content — it never scrolls away. What it does
        do on the blocks list is shrink once there is something above the fold,
        and take a shadow, so the row reads as sitting over the grid rather than
        floating in the same plane as it.

        Over the map it is lifted out of the column entirely and floats. The
        drawing then runs the full height of the window and the sea carries on
        behind the wordmark instead of stopping at a band of flat colour — which
        is what tells a reader the header is lying on the map rather than
        holding it down, and what lets the land slide under it when the map is
        dragged.
      */}
      <header
        className={`z-30 flex items-start justify-between gap-4 px-4 transition-all
                    duration-base ease-out sm:px-6
                    ${showMap ? 'absolute inset-x-0 top-0 pt-4' : 'relative'}
                    ${compact ? 'on-canvas pb-2 pt-2 shadow-[var(--shadow-card)] backdrop-blur' : 'pt-4'}`}
      >
        {/* Over open water and over a continent alike, so the lettering that
            has no plate under it carries the same halo the map's own names do. */}
        <div className={`flex items-baseline gap-3 ${showMap ? 'over-map' : ''}`}>
          {/* The wordmark is the way home, as it is on every site — and home
              here is the map: from a filtered or searched view, and from the
              blocks, it leads back to the clean drawing. The way back from the
              columns is the other half of that pair: it returns to whichever
              view you left, this one always to the same place. */}
          <h1
            className={`font-display tracking-tight transition-all duration-base ease-out
                        ${compact ? 'text-base' : 'text-xl'}`}
          >
            <Link
              to="/"
              onClick={() => setMapView('map')}
              className="rounded transition-colors hover:text-accent"
            >
              {t('app.title')}
            </Link>
          </h1>
          {compact ? null : (
            <p className="hidden text-xs text-ink-faint lg:block">{t('app.tagline')}</p>
          )}
        </div>

        {/* Two plates rather than four buttons: what you are looking at on the
            left, and who is looking on the right. */}
        <div className="flex items-center gap-2">
          {isMobile ? null : (
            <ViewSwitch value={mapView} onChange={setMapView} />
          )}
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
      */}
      <div
        className={
          showMap
            ? 'pointer-events-none absolute inset-x-0 top-[72px] z-30 flex flex-col items-center gap-2 px-4'
            : 'z-30 flex flex-col items-center gap-2 px-4 pt-3 sm:px-6'
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
        className={`min-h-0 flex-1 ${showMap ? 'overflow-hidden' : 'overflow-auto'}`}
        style={showMap ? { background: MAP_SEA } : undefined}
        onScroll={(event) => setScrolled(event.currentTarget.scrollTop > 8)}
      >
        {showMap ? (
          <MapView
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
      </main>

      {/*
        The only place in the app that can offer a domain: nothing on screen is
        one, so there is nothing to hang a contextual link on. A playlist has
        its course panel and a missing course has the search — this covers the
        rest, and says the catalogue is written by the people reading it rather
        than merely licensed to them.
      */}
      <ContributeBar>{t('ui.footer.contribute')}</ContributeBar>
    </div>
  );
}

