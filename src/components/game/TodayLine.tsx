import { useT } from '@/i18n';
import { GAME, useDayLeft, useToday } from '@/lib/gamification';

/**
 * [game:today] — the session, said where the decision about it is made.
 *
 * Two facts, both already in `profile.days`: what today has come to, and what
 * is left of the day it was meant to be. Neither is new information — the
 * profile panel has said both for as long as it has existed — and that is
 * exactly the problem this fixes. Nobody decides whether to watch one more
 * lecture while looking at the profile; they decide it in the two seconds
 * after one ends, with the player still open. «Ещё 20 минут» is a different
 * sentence there than it is three screens away.
 *
 * Two homes, one line. The player is where "one more lecture" is decided and
 * the front page's card is where "anything at all tonight" is, and both are
 * questions about the next twenty minutes. Rendering the same component in
 * both is what makes it impossible for the two screens to say different things
 * about the same afternoon — the fact keeps its source when it moves, which is
 * the half of these moves that usually goes wrong
 * (`practices.md`, «a strip that narrates the current row»).
 *
 * The day rather than the week, and that is the whole reason the goal is
 * stored as a day: «осталось 3,5 часа до цели недели» is true, unactionable
 * and faintly depressing at eleven at night, while «25 из 45 минут» is a
 * decision about the lecture that just ended. The week is still the bar on the
 * front page, where looking back is the point.
 *
 * Silent about today until there is something to say. A «сегодня — 0 лекций»
 * over somebody's first evening is the same scolding as «0 дней подряд», and
 * the front page already refuses to print that one. The goal's half stays
 * either way, being about a target rather than about the day so far.
 */
export default function TodayLine({ className = '' }: { className?: string }) {
  if (!GAME.today) return null;
  return <Line className={className} />;
}

function Line({ className }: { className: string }) {
  const { t, count, span } = useT();
  const today = useToday();
  const day = useDayLeft();

  const studiedToday = today.seconds > 0 || today.lectures > 0;
  if (!studiedToday && !day) return null;

  /*
   * One unit for the whole line, taken from the longer of the two stretches on
   * it. A goal of 45 minutes read against an afternoon of two and a half hours
   * printed «Сегодня — 2,5 из 45 минут» — arithmetically right, and the pair
   * the sentence exists to compare is in two different units. The same rule the
   * week's bar follows for «45 минут из 5 часов».
   */
  const scale = day ? Math.max(today.seconds, day.target) : today.seconds;

  /*
   * With a goal the day is a position — «Сегодня — 25 из 45 минут» — and
   * without one it is a report of what happened. The same slot either way: a
   * goal turns the number into a fraction of something, it does not add a
   * second line about the same afternoon.
   */
  const todayText = day
    ? t('ui.game.todayOf', {
        done: span(today.seconds, scale).value,
        target: span(day.target, scale).text,
      })
    : today.lectures
      ? t('ui.game.today', {
          lectures: count(today.lectures, 'lecture'),
          time: span(today.seconds).text,
        })
      : t('ui.game.todayTime', { time: span(today.seconds).text });

  /*
   * And what is left of it — which becomes, on the day it is made, what the
   * week now stands at. «День закрыт» on its own is a full stop; with «3 из 5
   * дней недели» after it the reader is looking at the next square rather than
   * at a finished one.
   */
  const goalText = !day
    ? null
    : day.met
      ? t('ui.game.dayMet', { closed: day.closed, days: day.days })
      : day.weekMet
        ? // The days of the week are all made and today is not one of them —
          // which is a rest day, not a shortfall. A goal of «45 минут, 5 дней»
          // is a week with two days off written into it, and a line asking for
          // a sixth would be the site handing out a target nobody set. So the
          // ask goes and the standing is what is left to say.
          t('ui.game.weekMet', { closed: day.closed, days: day.days })
        : studiedToday
          ? // «Сегодня — 25 из 45 минут · ещё 20 минут». The unit is already on
            // the line in front of it and the word «цель» is what «из 45» means.
            t('ui.game.dayLeft', { time: span(day.seconds, scale).text })
          : // With nothing behind today the remainder is the whole target, and
            // on its own it needs saying what it is a remainder of. «0 из 45» is
            // the alternative, and a zero over somebody's morning is a scolding.
            t('ui.game.dayTarget', { time: span(day.seconds).text });

  /*
   * One string rather than two spans with a separator between them.
   *
   * This lands in a sidebar seventeen rems wide, where the two halves wrap
   * more often than not — and a separator drawn as its own element hangs off
   * the end of the first line when they do. Inside the text it wraps the way
   * any other word does. Both halves keep their capital for the same reason:
   * either can be the only one on the line.
   *
   * The accent is for the whole line when a day or a week is made, which is the
   * only news here: elsewhere it is a report, and a report is quiet.
   */
  const line = [studiedToday ? todayText : null, goalText].filter(Boolean).join(' · ');
  const news = Boolean(day?.met || day?.weekMet);

  return (
    <p className={`num text-[11px] ${news ? 'text-accent' : 'ink-soft'} ${className}`}>{line}</p>
  );
}
