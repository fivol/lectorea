import { useMemo, useState } from 'react';
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
import MapView from './MapView';
import BlocksView from './BlocksView';

export default function MapScreen() {
  const catalog = useCatalog();
  const { t } = useT();
  const params = useCatalogParams();
  const isMobile = useIsMobile();
  const openProfile = useUi((state) => state.openProfile);

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

  return (
    <div className="flex h-full flex-col">
      <header className="relative z-30 flex items-start justify-between gap-4 px-4 pt-4 sm:px-6">
        <div className="flex items-baseline gap-3">
          <h1 className="font-display text-xl tracking-tight">{t('app.title')}</h1>
          <p className="hidden text-xs text-ink-faint lg:block">{t('app.tagline')}</p>
        </div>

        <div className="flex items-center gap-2">
          {isMobile ? null : (
            <div className="flex overflow-hidden rounded-lg border border-line" role="group">
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
          <button
            type="button"
            className="btn"
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
          <p className="pointer-events-auto rounded-full bg-surface/80 px-3 py-1 text-xs text-ink-faint backdrop-blur">
            {t('ui.search.empty')}
          </p>
        ) : null}
      </div>

      {/* The floating field sits over the map, so the canvas keeps clear of it. */}
      <main className={`min-h-0 flex-1 overflow-auto ${showMap ? 'pt-16' : ''}`}>
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
      className={`flex items-center gap-1.5 px-3 py-1.5 text-sm transition-colors
                  ${active ? 'bg-surface-2 text-ink' : 'text-ink-faint hover:text-ink'}`}
    >
      <Icon name={icon} size={14} />
      {label}
    </button>
  );
}
