import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { BuiltDomain, Continent } from '@shared/schema';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { AS_SHAPE, inkOn, withAlpha } from '@/lib/format';
import { fieldHref, useCatalogParams } from '@/lib/url';
import { useIsMobile } from '@/lib/hooks';
import { useProfile, useResolvedTheme } from '@/store/profile';
import Icon from '@/components/Icon';
import DomainIcon from '@/components/DomainIcon';
import ProfileSummary from '@/components/ProfileSummary';

type Props = {
  matched: Set<string>;
  searchActive: boolean;
  allowed: Set<string> | null;
};

const CONTINENTS: Continent[] = ['formal', 'social', 'humanities'];

/**
 * The same content as the map, as a grid of cards grouped by continent.
 *
 * It used to be the only view a narrow screen could have. It is a choice on
 * every screen now — the map has a drawing that fits a phone — and it is still
 * the faster way to read the catalogue when what you want is the list rather
 * than the picture.
 */
export default function BlocksView({ matched, searchActive, allowed }: Props) {
  const catalog = useCatalog();
  const { t } = useT();
  const isMobile = useIsMobile();
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
    /* Room at the foot for the view switch, which floats over this list on a
       phone rather than taking a row of its own. */
    <div className="mx-auto w-full max-w-6xl px-4 pb-24 pt-4 sm:px-6 sm:pb-16">
      {/* Above the continents, because it is about the reader rather than about
          the catalogue, and what somebody was in the middle of outranks the
          thirty-nine fields they were not. It scrolls away with the page — the
          avatar stays in the header for exactly that reason.

          Not on a phone, where the desk is one of the three places along the
          bottom of the screen and this would be the same offer twice, one of
          them costing the list its first screenful. */}
      {isMobile ? null : <ProfileSummary variant="section" className="mb-8" />}

      {CONTINENTS.map((continent) => {
        const domains = catalog.domains.filter((domain) => domain.continent === continent);
        if (!domains.length) return null;
        return (
          <section key={continent} className="mb-10">
            {/* Named the way the map names a continent: quiet tracked capitals
                in the page's own ink, with the hue left to the ground below —
                the cards, which already wear their field's colour. A 22px title
                in full-strength blue was louder than everything it introduced,
                and it was a hue the map never uses. */}
            <header
              className="mb-3 border-b pb-2"
              style={{
                borderColor: `color-mix(in srgb, var(--c-${continent}) 40%, var(--c-line))`,
              }}
            >
              <h2 className="text-h3 uppercase tracking-[0.18em] text-ink">
                {t(`ui.continent.${continent}`)}
              </h2>
              <p className="mt-1.5 text-body text-ink-dim">
                {t(`ui.continent.${continent}.desc`)}
              </p>
            </header>
            {/* One card per row on a phone: at two columns the long titles —
                "Вероятность и статистика" — broke into three lines and shoved
                the glyph off the text it labels. */}
            <div className="grid grid-cols-1 gap-2.5 min-[480px]:grid-cols-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-4">
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
  // The card carries the filters standing above it into the field it opens —
  // the university and lecturer chips are set on this very screen.
  const { search } = useCatalogParams();
  // Three jobs, three bars. The stripe and the border are washes behind
  // something else and wear the raw hue. The glyph is a shape, read by its
  // outline, so it takes the hue at 3:1. The counter is text and takes it at
  // 4.5:1. All three come off one palette — see `inkOn`.
  const scheme = useResolvedTheme();
  const counterColour = inkOn(domain.color, scheme);
  const glyphColour = inkOn(domain.color, scheme, AS_SHAPE);

  return (
    <Link
      to={fieldHref(search, domain.id)}
      className={`surface group relative flex flex-col gap-2 overflow-hidden p-3.5 sm:p-4
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
      <h3 className="flex min-w-0 items-center gap-2.5 text-h3 leading-snug text-ink">
        <DomainIcon
          domainId={domain.id}
          size={30}
          strokeWidth={1.5}
          style={{ color: glyphColour }}
        />
        <span className="min-w-0">{t(`domain.${domain.id}.title`)}</span>
      </h3>
      {/* One line on a full-width card cut every description mid-sentence and
          left the card shorter than its own title block. At ~53 characters per
          line the longest description here needs two, so three is the cap that
          never truncates on a phone; from two columns up the card is half as
          wide and two lines is all the height the grid can spend. */}
      <p className="line-clamp-3 text-caption text-ink-faint min-[480px]:line-clamp-2">
        {t(`domain.${domain.id}.desc`)}
      </p>
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
