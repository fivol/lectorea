import { Link } from 'react-router-dom';
import type { BuiltDomain, Continent } from '@shared/schema';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { withAlpha } from '@/lib/format';
import Icon from '@/components/Icon';

type Props = {
  matched: Set<string>;
  searchActive: boolean;
  allowed: Set<string> | null;
};

const CONTINENTS: Continent[] = ['formal', 'social', 'humanities'];

/**
 * The same content as the map, as a grid of cards grouped by continent.
 * This is also the only view on narrow screens, where a territory map is
 * unreadable and un-tappable.
 */
export default function BlocksView({ matched, searchActive, allowed }: Props) {
  const catalog = useCatalog();
  const { t } = useT();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-4 sm:px-6">
      {CONTINENTS.map((continent) => {
        const domains = catalog.domains.filter((domain) => domain.continent === continent);
        if (!domains.length) return null;
        return (
          <section key={continent} className="mb-10">
            <header className="mb-3 border-b border-line pb-2">
              <h2 className="font-display text-lg" style={{ color: `var(--c-${continent})` }}>
                {t(`ui.continent.${continent}`)}
              </h2>
              <p className="mt-1 text-sm text-ink-dim">{t(`ui.continent.${continent}.desc`)}</p>
            </header>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {domains.map((domain) => (
                <DomainCard
                  key={domain.id}
                  domain={domain}
                  dimmed={
                    (allowed !== null && !allowed.has(domain.id)) ||
                    (searchActive && matched.size > 0 && !matched.has(domain.id))
                  }
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function DomainCard({ domain, dimmed }: { domain: BuiltDomain; dimmed: boolean }) {
  const { t, count } = useT();

  return (
    <Link
      to={`/courses?domain=${encodeURIComponent(domain.id)}`}
      className={`surface group relative flex flex-col gap-2 overflow-hidden p-3 transition-all
                  duration-150 ease-out hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)]
                  ${dimmed ? 'opacity-40' : ''}`}
      style={{ borderColor: withAlpha(domain.color, 0.35) }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-1 transition-opacity duration-150 group-hover:opacity-100"
        style={{ background: domain.color, opacity: 0.6 }}
      />
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold leading-snug text-ink">
          {t(`domain.${domain.id}.title`)}
        </h3>
        {domain.bridge ? (
          <span
            className="chip shrink-0 px-1.5 py-0 text-[10px]"
            title={t('ui.map.bridge')}
            style={{ color: domain.color, borderColor: withAlpha(domain.color, 0.4) }}
          >
            ⧗
          </span>
        ) : null}
      </div>
      <p className="line-clamp-2 text-xs text-ink-faint">{t(`domain.${domain.id}.desc`)}</p>
      <div className="mt-auto flex items-center justify-between pt-1">
        <span className="num text-xs" style={{ color: domain.color }}>
          {domain.courseCount ? count(domain.courseCount, 'course') : t('ui.map.emptyDomain')}
        </span>
        <Icon name="chevron-right" size={14} className="text-ink-faint" />
      </div>
    </Link>
  );
}
