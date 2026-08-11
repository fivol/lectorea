import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { useSearchResults } from '@/lib/search';
import { useCatalogParams } from '@/lib/url';
import { useIsMobile } from '@/lib/hooks';
import { useProfile } from '@/store/profile';
import { useUi } from '@/store/ui';
import SearchBox from '@/components/SearchBox';
import GlobalFilters from '@/components/GlobalFilters';
import Icon from '@/components/Icon';
import ThemeToggle from '@/components/ThemeToggle';
import MapView, { MAP_SEA } from './MapView';
import BlocksView from './BlocksView';

export default function MapScreen() {
  const catalog = useCatalog();
  const { t } = useT();
  const params = useCatalogParams();
  const isMobile = useIsMobile();
  const openProfile = useUi((state) => state.openProfile);
  const [scrolled, setScrolled] = useState(false);

  const mapView = useProfile((state) => state.profile.settings.mapView);
  const setSetting = useProfile((state) => state.setSetting);

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

  const showMap = mapView === 'map' && !isMobile;
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
      */}
      <header
        className={`relative z-30 flex items-start justify-between gap-4 px-4 transition-all
                    duration-base ease-out sm:px-6
                    ${compact ? 'on-canvas pb-2 pt-2 shadow-[var(--shadow-card)] backdrop-blur' : 'pt-4'}`}
      >
        <div className="flex items-baseline gap-3">
          {/* The wordmark is the way home, as it is on every site: from a
              filtered or searched map it leads back to the clean one, and the
              link is what makes that discoverable at all. */}
          <h1
            className={`font-display tracking-tight transition-all duration-base ease-out
                        ${compact ? 'text-base' : 'text-xl'}`}
          >
            <Link to="/" className="rounded transition-colors hover:text-accent">
              {t('app.title')}
            </Link>
          </h1>
          {compact ? null : (
            <p className="hidden text-xs text-ink-faint lg:block">{t('app.tagline')}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isMobile ? null : (
            /* The group carries the plate, not the buttons: with only the
               active half filled, the other half was a hole showing the water
               through a white outline. */
            <div
              className={`glass-strong flex overflow-hidden rounded-lg border border-line
                          ${showMap ? 'shadow-[var(--shadow-card)]' : ''}`}
              role="group"
            >
              <ViewButton
                active={mapView === 'map'}
                onClick={() => setSetting('mapView', 'map')}
                icon="map"
                label={t('ui.view.map')}
              />
              <ViewButton
                active={mapView === 'blocks'}
                onClick={() => setSetting('mapView', 'blocks')}
                icon="grid"
                label={t('ui.view.blocks')}
              />
            </div>
          )}
          {/* On the water the controls need to sit on something. A shadow is
              what makes a white plate read as floating over the sea rather than
              as a hole cut through it. */}
          <ThemeToggle className={`tap ${showMap ? 'shadow-[var(--shadow-card)]' : ''}`} />
          <button
            type="button"
            className={`btn tap ${showMap ? 'shadow-[var(--shadow-card)]' : ''}`}
            onClick={openProfile}
            aria-label={t('ui.nav.profile')}
          >
            <Icon name="profile" />
            <span className="hidden sm:inline">{t('ui.nav.profile')}</span>
          </button>
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
          <p className="glass pointer-events-auto rounded-full px-3 py-1 text-xs text-ink-faint backdrop-blur">
            {t('ui.search.empty')}
          </p>
        ) : null}
      </div>

      {/*
        The floating field sits over the map, so the canvas keeps clear of it.

        In map mode the whole area takes the sea's own colour. The drawing is
        16:9 and the window is not, so without it the map ends in two bands of
        page background — which reads as a picture pinned to a page rather than
        as a map you are looking at.
      */}
      <main
        className={`min-h-0 flex-1 overflow-auto ${showMap ? 'pt-16' : ''}`}
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

      <footer className="px-4 pb-3 text-center text-xs text-ink-faint sm:px-6">
        {t('ui.footer.contribute')}
      </footer>
    </div>
  );
}

function ViewButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: 'map' | 'grid';
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      // The selected half is the darker one. On a white plate an even whiter
      // fill is not a state, and that is what «Карта» looked like.
      className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors
                  ${active ? 'seg-on text-ink' : 'seg-off text-ink-faint hover:text-ink'}`}
    >
      <Icon name={icon} size={14} />
      {label}
    </button>
  );
}
