import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { useCatalogParams } from '@/lib/url';
import Icon from './Icon';
import { Button, Chip } from '@/components/ui';

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
        <Chip key={chip.key} filled>
          {chip.label}
          <button
            type="button"
            onClick={chip.remove}
            aria-label={`${t('ui.filter.provider.off')}: ${chip.label}`}
            className="-mr-1 rounded p-0.5 hover:bg-black/15"
          >
            <Icon name="close" size={12} />
          </button>
        </Chip>
      ))}
      {chips.length > 1 ? (
        <Button variant="ghost" small onClick={params.clearGlobalFilters}>
          {t('ui.filter.resetAll')}
        </Button>
      ) : null}
    </div>
  );
}
