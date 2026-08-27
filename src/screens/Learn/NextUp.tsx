import { useMemo } from 'react';
import type { BuiltCourse } from '@shared/schema';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { useGoals } from '@/lib/goals';
import { AS_SHAPE, formatHours, inkOn, withAlpha } from '@/lib/format';
import { useProfile, useResolvedTheme } from '@/store/profile';
import DomainIcon from '@/components/DomainIcon';
import Icon from '@/components/Icon';
import { useProfileNavigation } from './navigate';
import Section from './Section';

/**
 * «Что можно начать сейчас» — the one question the graph could always answer
 * and nothing ever asked it.
 *
 * Every other shelf on this page is a report of a decision the reader has
 * already made: what they are studying, what they saved, what is behind them.
 * This is the only one that is about the catalogue rather than about them, and
 * it is what turns the desk from a diary into a place worth opening: a course
 * is here precisely because every prerequisite it has is already ticked off, so
 * the offer cannot be a course somebody would open and immediately fail to
 * follow.
 *
 * Nothing is offered to somebody with no history — the shelf is empty on a
 * clean profile, which is exactly right: a reader who has finished nothing has
 * unlocked nothing, and a list of every level-0 course is the map's job.
 */

/** Four. A shelf that scrolls is a screen, and this one is an aside on a page. */
const LIMIT = 4;

export default function NextUp() {
  const { t } = useT();
  const catalog = useCatalog();
  const courses = useProfile((state) => state.profile.courses);
  const goals = useGoals();

  const ready = useMemo(() => {
    const done = new Set<string>();
    for (const [id, entry] of Object.entries(courses)) {
      if (entry.status === 'done') done.add(id);
    }
    if (!done.size) return [];

    /*
     * Courses on the way to a goal come first, and by a whole rank rather than
     * by a tie-break: somebody who marked «глубокое обучение» as their goal is
     * not asking what else the catalogue could offer them this evening. The
     * path is the union of every goal's steps, so a prerequisite two goals
     * share is on it once.
     */
    const wanted = new Set<string>();
    for (const goal of goals) for (const id of goal.steps) wanted.add(id);

    const out: Array<{ course: BuiltCourse; onPath: boolean }> = [];
    for (const course of catalog.courses) {
      if (done.has(course.id)) continue;
      // Already in hand: the shelf above says so, and saying it twice on one
      // page is the page disagreeing with itself about what "next" means.
      if (courses[course.id]?.status === 'in_progress') continue;
      // An empty course is a card with nothing behind it — honest on the map,
      // where the gap is the point, and useless as an offer.
      if (!course.playlistCount) continue;
      if (!course.deps.every((dep) => done.has(dep))) continue;
      out.push({ course, onPath: wanted.has(course.id) });
    }

    return out
      .sort((a, b) => {
        if (a.onPath !== b.onPath) return a.onPath ? -1 : 1;
        // Then by what it opens up: the course that unlocks eleven others is a
        // better answer to "what now" than the leaf beside it.
        const behind = (catalog.behind.get(b.course.id) ?? 0) - (catalog.behind.get(a.course.id) ?? 0);
        if (behind) return behind;
        return b.course.playlistCount - a.course.playlistCount;
      })
      .slice(0, LIMIT);
  }, [catalog, courses, goals]);

  if (!ready.length) return null;

  return (
    <Section title={t('ui.learn.next')} hint={t('ui.learn.next.hint')}>
      <div className="grid gap-3 sm:grid-cols-2">
        {ready.map(({ course, onPath }) => (
          <NextCard key={course.id} course={course} onPath={onPath} />
        ))}
      </div>
    </Section>
  );
}

function NextCard({ course, onPath }: { course: BuiltCourse; onPath: boolean }) {
  const { t, count } = useT();
  const catalog = useCatalog();
  const { openCourse } = useProfileNavigation();
  const domain = catalog.domainById.get(course.domains[0]);
  const opens = catalog.behind.get(course.id) ?? 0;
  // The glyph is a shape read by its outline, so it takes the field's hue at
  // 3:1 — the same reading the blocks give it. See `inkOn`.
  const scheme = useResolvedTheme();

  return (
    <button
      type="button"
      onClick={() => openCourse(course.id)}
      /* `min-w-0` because a grid item's floor is its content, and the content
         here is a line of catalogue numbers that would rather run off the
         screen than wrap — which is exactly what it did. */
      className="surface flex w-full min-w-0 items-center gap-3 p-3 text-left transition-colors
                 duration-fast ease-out hover:border-accent"
      style={domain ? { borderColor: withAlpha(domain.color, 0.35) } : undefined}
    >
      {domain ? (
        <DomainIcon
          domainId={domain.id}
          size={22}
          className="shrink-0"
          style={{ color: inkOn(domain.color, scheme, AS_SHAPE) }}
        />
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">
          {t(`course.${course.id}.title`)}
        </span>
        <span className="num mt-0.5 block truncate text-xs text-ink-faint">
          {/* What it costs and what it buys, in that order: the hours are the
              decision and the unlocks are the reason. Both are the catalogue's
              own numbers, so neither waits on a shard. */}
          {course.hours ? `${t('ui.course.hoursShort', { n: formatHours(course.hours) })} · ` : ''}
          {count(course.playlistCount, 'playlist')}
          {opens ? ` · ${t('ui.learn.next.opens', { n: opens })}` : ''}
        </span>
      </span>
      {onPath ? (
        <span className="shrink-0 text-accent" title={t('ui.learn.next.onPath')}>
          <Icon name="target" size={14} />
        </span>
      ) : null}
    </button>
  );
}
