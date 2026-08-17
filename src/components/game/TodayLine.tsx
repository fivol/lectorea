import { useT } from '@/i18n';
import { GAME, useToday, useWeekLeft } from '@/lib/gamification';

/**
 * [game:today] — the session, said where the decision about it is made.
 *
 * Two facts, both already in `profile.days`: what today has come to, and what
 * is left of the week's goal. Neither is new information — the profile panel
 * has said both for as long as it has existed — and that is exactly the
 * problem this fixes. Nobody decides whether to watch one more lecture while
 * looking at the profile; they decide it in the two seconds after one ends,
 * with the player still open. «До цели недели — 40 минут» is a different
 * sentence there than it is three screens away.
 *
 * Silent about today until there is something to say. A «сегодня — 0 лекций»
 * over somebody's first evening is the same scolding as «0 дней подряд», and
 * the front page already refuses to print that one. The week's half stays
 * either way, being about a target rather than about the day.
 */
export default function TodayLine({ className = '' }: { className?: string }) {
  if (!GAME.today) return null;
  return <Line className={className} />;
}

function Line({ className }: { className: string }) {
  const { t, count, span } = useT();
  const today = useToday();
  const week = useWeekLeft();

  const studiedToday = today.seconds > 0 || today.lectures > 0;
  if (!studiedToday && !week) return null;

  const todayText = today.lectures
    ? t('ui.game.today', {
        lectures: count(today.lectures, 'lecture'),
        time: span(today.seconds).text,
      })
    : t('ui.game.todayTime', { time: span(today.seconds).text });
  const weekText = week
    ? week.met
      ? t('ui.game.weekMet')
      : t('ui.game.weekLeft', { time: span(week.seconds).text })
    : null;

  /*
   * One string rather than two spans with a separator between them.
   *
   * This lands in a sidebar seventeen rems wide, where the two halves wrap
   * more often than not — and a separator drawn as its own element hangs off
   * the end of the first line when they do. Inside the text it wraps the way
   * any other word does. Both halves keep their capital for the same reason:
   * either can be the only one on the line.
   *
   * The accent is for the whole line when the week is made, which is the one
   * piece of news here: elsewhere it is a report, and a report is quiet.
   */
  const line = [studiedToday ? todayText : null, weekText].filter(Boolean).join(' · ');

  return (
    <p className={`num text-[11px] ${week?.met ? 'text-accent' : 'ink-soft'} ${className}`}>
      {line}
    </p>
  );
}
