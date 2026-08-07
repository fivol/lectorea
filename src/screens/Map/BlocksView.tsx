import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { BuiltDomain, Continent } from '@shared/schema';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { inkOn, withAlpha } from '@/lib/format';
import { useProfile, useResolvedTheme } from '@/store/profile';
import Icon from '@/components/Icon';
import DomainIcon from '@/components/DomainIcon';
import Tooltip from '@/components/Tooltip';

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
  const courses = useProfile((state) => state.profile.courses);

  /**
   * Ticks made anywhere — the panel, the player, the profile — land here, so
   * the first screen answers "how far am I" without being told to refresh.
   */
  const doneByDomain = useMemo(() => {
    const counts = new Map<string, number>();
    for (const course of catalog.courses) {
      if (courses[course.id]?.status !== 'done') continue;
      for (const id of course.domains) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [catalog.courses, courses]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-4 sm:px-6">
      {CONTINENTS.map((continent) => {
        const domains = catalog.domains.filter((domain) => domain.continent === continent);
        if (!domains.length) return null;
        return (
          <section key={continent} className="mb-10">
            <header className="mb-3 border-b border-line pb-2">
              <h2 className="font-display text-h2" style={{ color: `var(--c-${continent})` }}>
                {t(`ui.continent.${continent}`)}
              </h2>
              <p className="mt-1 text-body text-ink-dim">{t(`ui.continent.${continent}.desc`)}</p>
            </header>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {domains.map((domain) => (
                <DomainCard
                  key={domain.id}
                  domain={domain}
                  done={doneByDomain.get(domain.id) ?? 0}
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

function DomainCard({
  domain,
  done,
  dimmed,
}: {
  domain: BuiltDomain;
  done: number;
  dimmed: boolean;
}) {
  const { t, count } = useT();
  // The stripe and the glyph can wear the raw domain hue — they are shapes, and
  // 3:1 is enough for those. The counter is text, so it takes the version of
  // the hue that clears 4.5:1 on whichever card it is printed on.
  const scheme = useResolvedTheme();
  const counterColour = inkOn(domain.color, scheme);

  return (
    <Link
      to={`/courses?domain=${encodeURIComponent(domain.id)}`}
      className={`surface group relative flex flex-col gap-2 overflow-hidden p-4
                  transition-all duration-fast ease-out hover:-translate-y-0.5
                  hover:border-line-strong hover:shadow-[var(--shadow-pop)]
                  ${dimmed ? 'opacity-45' : ''}`}
      style={{ borderColor: withAlpha(domain.color, 0.35) }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-1 transition-opacity duration-fast group-hover:opacity-100"
        style={{ background: domain.color, opacity: 0.6 }}
      />
      <div className="flex items-start justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-2.5 text-h3 leading-snug text-ink">
          <DomainIcon
            domainId={domain.id}
            size={30}
            strokeWidth={1.5}
            style={{ color: domain.color }}
          />
          <span className="min-w-0">{t(`domain.${domain.id}.title`)}</span>
        </h3>
        {domain.bridge ? (
          /* A bridge, not an hourglass: the badge means "this field spans two
             continents", which an hourglass never managed to say. */
          <Tooltip content={t('ui.map.bridgeHint')}>
            <span
              className="chip shrink-0 px-1.5 py-0.5"
              aria-label={t('ui.map.bridge')}
              style={{ color: domain.color, borderColor: withAlpha(domain.color, 0.4) }}
            >
              <Icon name="bridge" size={12} />
            </span>
          </Tooltip>
        ) : null}
      </div>
      <p className="line-clamp-2 text-caption text-ink-faint">{t(`domain.${domain.id}.desc`)}</p>
      <div className="mt-auto flex items-center justify-between gap-2 pt-1">
        <span className="num min-w-0 truncate text-xs" style={{ color: counterColour }}>
          {domain.courseCount ? count(domain.courseCount, 'course') : t('ui.map.emptyDomain')}
          {done ? (
            <span className="text-accent"> · {t('ui.map.domainDone', { n: done })}</span>
          ) : null}
        </span>
        <Icon name="chevron-right" size={14} className="shrink-0 text-ink-faint" />
      </div>
    </Link>
  );
}
