import { useEffect, useState } from 'react';
import {
  POMODORO_BREAK,
  POMODORO_EVERY,
  POMODORO_FOCUS,
  POMODORO_LONG,
} from '@shared/schema';
import { useT } from '@/i18n';
import { track } from '@/lib/analytics';
import { formatDuration } from '@/lib/format';
import { leftOf, type Pomodoro } from '@/lib/pomodoro';
import { useProfile } from '@/store/profile';
import Dropdown, { useCloseDropdown } from '@/components/Dropdown';
import Icon from '@/components/Icon';
import { Button, Segmented, cx } from '@/components/ui';

/**
 * The pomodoro, in the two places a timer over a lecture belongs.
 *
 * `PomodoroPill` is the control: it stands in the strip under the picture with
 * the speed and the question button, because that strip is what the player
 * cannot carry itself and is pressed while the lecture runs. `PomodoroCover` is
 * the rest: it covers the picture, because a rest that leaves the video visible
 * is not a rest, and because the reader has to be able to see from the far side
 * of the room whether it is time to come back.
 *
 * Neither of them is drawn until the timer has been started by hand — the whole
 * mechanic is one press wide and silent until then. See `src/lib/pomodoro.ts`
 * for the clock and why it is not the clock the profile counts hours on.
 */

/**
 * The panel holds controls rather than a list of names, so it is wider than a
 * filter menu — measured against the longest ladder, because a rung that hangs
 * off the side is a setting nobody finds. It is also why the session ladder is
 * five rungs and not six.
 */
const PANEL_WIDTH = 340;

export function PomodoroPill({ pomodoro }: { pomodoro: Pomodoro }) {
  const { t } = useT();
  const { phase, endsAt } = pomodoro;

  const running = phase !== 'off';
  /* Accented from the moment the lecture stops: the rest and the end of it are
     the two states that are about the reader rather than about the clock, and
     the pill is the only sign of them on a phone that has scrolled the picture
     out of view. */
  const news = phase === 'break' || phase === 'over';

  /*
   * The name stands down on a phone and the clock never does.
   *
   * This strip is shared with the speeds, which are the control pressed *during*
   * a lecture and already scroll sideways to fit; a word taking a third of the
   * row from them costs the reader the rate they are watching at, for a button
   * that is pressed once an evening. What is running cannot be abbreviated, so
   * the countdown stays at every width — and with nothing running the glyph is
   * a clock, which is what the tooltip and the accessible name say too.
   */
  const label =
    phase === 'focus' || phase === 'break' ? (
      <Countdown endsAt={endsAt} />
    ) : (
      <span className="hidden sm:inline">
        {phase === 'over' ? t('ui.pomodoro.resume') : t('ui.pomodoro.name')}
      </span>
    );

  return (
    <Dropdown
      label={t('ui.pomodoro.name')}
      width={PANEL_WIDTH}
      fit
      className="shrink-0"
      trigger={({ open, toggle }) => (
        /* A ghost and bare numerals, like the speeds beside it: this strip sits
           under a running lecture and a capsule here shouts over it. */
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          aria-label={t('ui.pomodoro.name')}
          title={t('ui.pomodoro.name')}
          className={cx(
            `num inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1
             text-[11px] leading-none transition-colors duration-fast ease-out`,
            news
              ? 'font-semibold text-accent'
              : running
                ? 'text-ink hover:text-accent'
                : 'text-ink-faint hover:text-ink'
          )}
        >
          <Icon name="clock" size={13} />
          {label}
        </button>
      )}
    >
      <Panel pomodoro={pomodoro} />
    </Dropdown>
  );
}

/**
 * The four lengths, and the press under them.
 *
 * Read top to bottom it is one sentence — a session of this, a break of that,
 * a long one every so many, and then «Запустить». The press was above the
 * ladders to begin with, which put the answer before the question and left the
 * hand travelling back up the panel after setting the last of them.
 *
 * Its own component because `useCloseDropdown` only reaches the tree the
 * popover renders: the hook is read where the rows are, not where the
 * `Dropdown` is written.
 */
function Panel({ pomodoro }: { pomodoro: Pomodoro }) {
  const { t } = useT();
  const { phase, done, long, settings } = pomodoro;
  const setSetting = useProfile((state) => state.setSetting);
  const close = useCloseDropdown();
  const running = phase !== 'off';

  return (
    <div className="space-y-1.5 px-1 pb-1">
      {/*
        What this is, and — while it is running — what it is doing, on the one
        line. Two lines would move every control under them by fifteen pixels
        at the moment the timer starts, and the panel would jump under the
        hand that had just pressed something.
      */}
      <p className="mono-label">
        {t('ui.pomodoro.name')}
        {running ? (
          <span className="text-ink-dim">
            {' · '}
            {phase === 'focus'
              ? t('ui.pomodoro.session', { n: done + 1 })
              : phase === 'over'
                ? t('ui.pomodoro.over')
                : // Two calls rather than one with the key chosen inside it:
                  // `check:i18n` reads literals, and a key reached only through
                  // a ternary looks to it like a string nothing uses.
                  long
                  ? t('ui.pomodoro.longBreak')
                  : t('ui.pomodoro.break')}
          </span>
        ) : null}
      </p>

      {/* The ladders stay put while it runs. A length changed mid-session takes
          effect on the next one — see the settings ref in the hook — and hiding
          them would mean stopping the timer to look at what it is set to. */}
      <Ladder
        label={t('ui.pomodoro.focus')}
        value={settings.focus}
        options={POMODORO_FOCUS}
        unit
        onChange={(next) => setSetting('pomodoroFocus', next)}
      />
      <Ladder
        label={t('ui.pomodoro.break')}
        value={settings.break}
        options={POMODORO_BREAK}
        unit
        onChange={(next) => setSetting('pomodoroBreak', next)}
      />
      <Ladder
        label={t('ui.pomodoro.every')}
        value={settings.every}
        options={POMODORO_EVERY}
        onChange={(next) => setSetting('pomodoroEvery', next)}
      />
      <Ladder
        label={t('ui.pomodoro.long')}
        value={settings.long}
        options={POMODORO_LONG}
        unit
        onChange={(next) => setSetting('pomodoroLong', next)}
      />

      {running ? (
        <Button icon="close" iconSize={14} className="w-full justify-center" onClick={pomodoro.stop}>
          {t('ui.pomodoro.stop')}
        </Button>
      ) : (
        /*
          Starting puts the panel away. Somebody who presses it has finished
          with this panel by definition — they came to set the lengths and did,
          and what they want to look at now is the lecture with a clock ticking
          beside it. The same rule the kit's single-choice rows follow, for the
          same reason: a control that is finished with should not have to be
          dismissed by hand. Stopping does not, because the panel then shows
          what stopping did.
        */
        <Button
          variant="primary"
          icon="clock"
          iconSize={14}
          className="w-full justify-center"
          onClick={() => {
            pomodoro.start();
            track('pomodoro_start', { value: String(settings.focus) });
            close();
          }}
        >
          {t('ui.pomodoro.start')}
        </Button>
      )}
    </div>
  );
}

/** One of the four numbers, on the ladder it is chosen from. */
function Ladder({
  label,
  value,
  options,
  unit = false,
  onChange,
}: {
  label: string;
  value: number;
  options: readonly number[];
  /** Minutes get the short «м»; a count of sessions is a bare numeral. */
  unit?: boolean;
  onChange: (next: number) => void;
}) {
  const { t } = useT();
  return (
    <div>
      <p className="mb-0.5 text-[11px] text-ink-dim">{label}</p>
      <Segmented
        value={String(value)}
        label={label}
        options={options.map((option) => ({
          value: String(option),
          label: unit ? t('ui.pomodoro.min', { n: option }) : String(option),
        }))}
        onChange={(next) => onChange(Number(next))}
      />
    </div>
  );
}

/**
 * The rest, over the picture.
 *
 * Over it rather than beside it, and covering the play button with it: the one
 * thing a rest has to do is be impossible to not notice and slightly awkward to
 * ignore. White on black whatever the theme, because what is underneath is a
 * video and video is black in both.
 */
export function PomodoroCover({ pomodoro }: { pomodoro: Pomodoro }) {
  const { t } = useT();
  const { phase, endsAt, done, long } = pomodoro;
  if (phase !== 'break' && phase !== 'over') return null;
  const resting = phase === 'break';

  return (
    <div
      className="absolute inset-0 z-10 flex animate-fade-in flex-col items-center justify-center
                 gap-2 bg-black/90 px-6 text-center text-white"
      role="status"
    >
      <p className="mono-label text-white/60">
        {!resting
          ? t('ui.pomodoro.over')
          : long
            ? t('ui.pomodoro.longBreak')
            : t('ui.pomodoro.break')}
      </p>
      {resting ? (
        <Countdown endsAt={endsAt} className="num text-3xl font-semibold sm:text-4xl" />
      ) : null}
      {/* Which session it was, and nothing about how many there are going to
          be: the count of sessions in an evening is not a number anybody set. */}
      {done ? <p className="num text-xs text-white/70">{t('ui.pomodoro.after', { n: done })}</p> : null}
      <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
        <Button variant="primary" icon="play" iconSize={14} onClick={pomodoro.resume}>
          {resting ? t('ui.pomodoro.skip') : t('ui.pomodoro.resume')}
        </Button>
        <button
          type="button"
          onClick={pomodoro.stop}
          className="rounded px-2 py-1 text-xs text-white/60 underline decoration-white/30
                     underline-offset-2 transition-colors duration-fast ease-out hover:text-white"
        >
          {t('ui.pomodoro.stop')}
        </button>
      </div>
    </div>
  );
}

/**
 * The digits, counted down where they are drawn.
 *
 * Its own second-by-second state, deliberately: the player is a thousand lines
 * of dialog wrapped round a live iframe, and a countdown held up there would
 * re-render the lot once a second for as long as somebody is watching. The
 * phase machine changes state only at a transition, so this is the only thing
 * on the screen that ticks.
 */
function Countdown({ endsAt, className = '' }: { endsAt: number; className?: string }) {
  const [left, setLeft] = useState(() => leftOf(endsAt));

  useEffect(() => {
    setLeft(leftOf(endsAt));
    const timer = window.setInterval(() => setLeft(leftOf(endsAt)), 1000);
    return () => window.clearInterval(timer);
  }, [endsAt]);

  // `formatDuration` answers «—» for nothing at all, which is right about a
  // lecture of unknown length and wrong about a clock that has just run out.
  return <span className={className}>{left ? formatDuration(left) : '0:00'}</span>;
}
