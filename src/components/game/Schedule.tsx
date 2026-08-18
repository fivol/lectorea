import { useT } from '@/i18n';
import { parseDay } from '@/lib/activity';
import { GAME, type PlanWeek } from '@/lib/gamification';

/**
 * [game:schedule] — the rule between two weeks of the plan.
 *
 * Sixty rows read as sixty rows. The same sixty with a rule every fourth one
 * saying «ТЕКУЩАЯ НЕДЕЛЯ · 4 лекции · 3,8 часа» read as a fortnight of
 * evenings, which is a thing somebody can decide to have.
 *
 * The label is a date and never a name. A name would have to be invented — the
 * measurement that settled it is in `gamification.ts`, where 6% of long
 * recordings turned out to carry a section marker anybody could parse — and
 * the two weeks nearest the reader are named by the calendar instead: this
 * one, the next one, and the dates from there on.
 *
 * It is a divider and not a lecture, so it leaves the list's semantics alone:
 * `role="presentation"` takes it out of the `<ol>` without taking its words
 * away from anybody reading with their ears.
 *
 * Nothing here subscribes to anything. Whether a stage was behind the reader
 * used to be asked per header on every write the player made; a week of the
 * plan holds only rows that are *ahead*, so the question does not arise and
 * the arithmetic all happens once, in `useSchedule`.
 */
export default function WeekHeader({ week }: { week: PlanWeek }) {
  if (!GAME.schedule) return null;
  return <Header week={week} />;
}

function Header({ week }: { week: PlanWeek }) {
  const { t, count, span, lang } = useT();

  /*
   * Both named weeks are written out rather than picked inside `t(…)`:
   * `check:i18n` reads the source as text, and a key assembled at the call
   * site is a key it reports dead — see the practice it is named in.
   */
  const label =
    week.index === 0
      ? t('ui.game.weekNow')
      : week.index === 1
        ? t('ui.game.weekNext')
        : range(week.from, week.to, lang);

  return (
    <li role="presentation" className="flex items-center gap-2 bg-surface-2/60 px-4 py-1.5">
      <span className={`mono-label ${week.index === 0 ? 'text-accent' : ''}`}>{label}</span>
      {/* What the rows under the rule come to — the one number here that is
          measured rather than planned, and the reason a week may be printed at
          all. */}
      <span className="num flex-1 truncate text-[11px] text-ink-faint">
        {t('ui.game.weekSize', {
          lectures: count(week.lectures, 'lecture'),
          time: span(week.seconds).text,
        })}
      </span>
    </li>
  );
}

/**
 * «13–19 окт.» and «29 сент. – 5 окт.», or «Oct 13 – 19» in English.
 *
 * `formatRange` rather than two formatted dates with a dash between them: it
 * is the one that knows a range inside a single month prints the month once,
 * and which side of the number that month goes on in each language.
 *
 * No year on it. The plan runs a quarter at the outside — `SCHEDULE_MAX_WEEKS`
 * is why — and «2026 г.» on a rule in a lecture list is a word doing no work.
 */
function range(from: string, to: string, lang: string): string {
  return new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'en-US', {
    day: 'numeric',
    month: 'short',
  }).formatRange(parseDay(from), parseDay(to));
}
