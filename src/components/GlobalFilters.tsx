import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { useCatalogParams } from '@/lib/url';
import Icon from './Icon';

/**
 * The provider and lecturer filters live above both screens, so they need a
 * loud, permanent marker. A filter that has been forgotten about is the single
 * best source of "the site is broken".
 */
export default function GlobalFilters({ className = '' }: { className?: string }) {
  const catalog = useCatalog();
  const params = useCatalogParams();
  const { t } = useT();

  const chips = [
    ...params.providers.map((id) => ({
      key: `v:${id}`,
      label: catalog.providers[id]?.title ?? id,
      remove: () => params.toggleProvider(id),
    })),
    ...params.lecturers.map((name) => ({
      key: `l:${name}`,
      label: name,
      remove: () => params.toggleLecturer(name),
    })),
  ];

  if (!chips.length) return null;

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="chip chip-active bg-accent text-canvas"
          style={{ background: 'var(--c-accent)' }}
        >
          {chip.label}
          <button
            type="button"
            onClick={chip.remove}
            aria-label={`${t('ui.filter.provider.off')}: ${chip.label}`}
            className="-mr-1 rounded p-0.5 hover:bg-black/15"
          >
            <Icon name="close" size={12} />
          </button>
        </span>
      ))}
      {chips.length > 1 ? (
        <button type="button" className="btn-ghost text-xs" onClick={params.clearGlobalFilters}>
          {t('ui.filter.resetAll')}
        </button>
      ) : null}
    </div>
  );
}
