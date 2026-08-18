import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useProfile } from '@/store/profile';

/**
 * A pomodoro over a lecture: the phase machine, the deadlines, and the chime.
 *
 * The one thing on these screens that **interrupts** the reader, and it earns
 * that by being asked for: nothing here starts on its own, nothing is offered
 * to somebody who has not pressed play on it, and one press ends it. That is
 * the same rule the goal and the week are written against — a target nobody
 * chose is a debt — with the difference that this one also stops the video, so
 * the bar for asking first is higher rather than lower.
 *
 * **Two clocks, and they are not the same clock.** This one is the wall: a
 * twenty-five-minute session is twenty-five minutes of the reader's evening
 * whatever speed the lecture runs at. What the profile counts is the other one
 * — the lecture's own hours, the distance the playhead travels, which at 2× is
 * twice the wall (`useYouTubePlayer`, `peak`). So a session of twenty-five
 * minutes at 2× puts fifty minutes of lecture behind somebody, and both numbers
 * are right about different questions. Nothing here writes to the profile:
 * a pomodoro is a way of spending an evening, not a thing that was studied.
 *
 * The deadline is an **absolute moment**, not a countdown that is decremented.
 * A tab in the background has its timers throttled to about one a minute and a
 * sleeping machine has none at all; a counter would drift by exactly the time
 * nobody was looking, which is the whole of a rest. An absolute deadline read
 * against `Date.now()` is late at worst, and late by the throttle rather than
 * by the nap.
 */

export type PomodoroPhase =
  /** Nothing is running. */
  | 'off'
  /** A session: the lecture plays and the clock runs down to the rest. */
  | 'focus'
  /** The rest: the lecture is paused and the screen says so. */
  | 'break'
  /**
   * The rest has run out and the chime has sounded — waiting for the reader.
   *
   * A state of its own rather than dropping straight back into `focus`,
   * because the reader is not at the machine: a session that starts itself
   * while somebody is still making tea is a session spent on an empty chair,
   * and the video would be playing to nobody. So the clock waits, and the
   * press that starts the next one is the same press that starts the lecture.
   */
  | 'over';

/** The four numbers a run is cut by, in minutes — and the count that is not. */
export type PomodoroSettings = {
  focus: number;
  break: number;
  /** Sessions between two long rests. */
  every: number;
  long: number;
};

export type Pomodoro = {
  phase: PomodoroPhase;
  /** When the stretch in hand runs out, epoch ms. Zero while off or over. */
  endsAt: number;
  /** Sessions finished since it was started — what «Сессия 3» counts. */
  done: number;
  /** Whether the rest in hand is the long one. */
  long: boolean;
  settings: PomodoroSettings;
  start: () => void;
  stop: () => void;
  /** End a rest early, or take up the next session after the chime. */
  resume: () => void;
};

type Run = Pick<Pomodoro, 'phase' | 'endsAt' | 'done' | 'long'>;

const OFF: Run = { phase: 'off', endsAt: 0, done: 0, long: false };

const MINUTE = 60_000;

/**
 * How often the deadline is looked at.
 *
 * A second is plenty: this only decides *when a phase changes*, and the digits
 * on screen are counted down by whoever draws them. Keeping the two apart is
 * what stops the player — a thousand lines of dialog around a live iframe —
 * re-rendering once a second for the whole of an evening.
 */
const TICK_MS = 1000;

/** The sound, and the only asset on the site that is not looked at. */
const CHIME = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/chime.mp3`;

export function usePomodoro(): Pomodoro {
  const focus = useProfile((state) => state.profile.settings.pomodoroFocus);
  const rest = useProfile((state) => state.profile.settings.pomodoroBreak);
  const every = useProfile((state) => state.profile.settings.pomodoroEvery);
  const long = useProfile((state) => state.profile.settings.pomodoroLong);
  const settings = useMemo<PomodoroSettings>(
    () => ({ focus, break: rest, every, long }),
    [focus, rest, every, long]
  );

  const [run, setRun] = useState<Run>(OFF);

  /**
   * The settings as the ticker sees them.
   *
   * Through a ref so that changing a length does not re-arm the stretch already
   * running: a reader who lengthens a session in the middle of one has asked
   * about the sessions to come, not for the clock in front of them to jump. The
   * next transition reads whatever is current.
   */
  const current = useRef(settings);
  current.current = settings;

  /**
   * The chime, kept across renders and **primed on the press that starts the
   * run**.
   *
   * A browser will not let a page make a noise nobody asked for: an element
   * that has never been played inside a user gesture is refused when the moment
   * to play it finally comes, which here is the one moment there is nobody at
   * the keyboard to press anything. Starting the timer is a gesture, so the
   * element is played there — at zero volume and stopped in the same breath —
   * and it is a trusted element from then on.
   */
  const chime = useRef<HTMLAudioElement | null>(null);
  const prime = useCallback((): void => {
    if (typeof Audio === 'undefined') return;
    const audio = (chime.current ??= new Audio(CHIME));
    audio.volume = 0;
    audio
      .play()
      .then(() => {
        audio.pause();
        audio.currentTime = 0;
        audio.volume = 1;
      })
      .catch(() => {
        // Refused anyway — an autoplay policy, a missing file, a browser with
        // no audio at all. The rest of the timer works without a sound, and a
        // silent chime must not take the run down with it.
        audio.volume = 1;
      });
  }, []);

  const start = useCallback((): void => {
    prime();
    setRun({ phase: 'focus', endsAt: Date.now() + current.current.focus * MINUTE, done: 0, long: false });
  }, [prime]);

  const stop = useCallback((): void => setRun(OFF), []);

  const resume = useCallback((): void => {
    setRun((was) =>
      was.phase === 'off'
        ? was
        : {
            phase: 'focus',
            endsAt: Date.now() + current.current.focus * MINUTE,
            done: was.done,
            long: false,
          }
    );
  }, []);

  useEffect(() => {
    if (run.phase !== 'focus' && run.phase !== 'break') return;

    const due = (): void => {
      if (Date.now() < run.endsAt) return;
      if (run.phase === 'focus') {
        const done = run.done + 1;
        const settings = current.current;
        // The long rest belongs to the session that completes the count, so it
        // is the *new* total that decides — four sessions of «каждые 4» end on
        // the long one, and the fifth starts the count again.
        const longNow = done % settings.every === 0;
        setRun({
          phase: 'break',
          endsAt: Date.now() + (longNow ? settings.long : settings.break) * MINUTE,
          done,
          long: longNow,
        });
        return;
      }
      // The rest is over: the chime is the whole point of the feature, since
      // this is the one transition the reader is not at the screen for.
      chime.current?.play().catch(() => {});
      setRun((was) => ({ ...was, phase: 'over', endsAt: 0 }));
    };

    const timer = window.setInterval(due, TICK_MS);
    // Coming back to the tab is the other moment worth checking: a background
    // tab's timers are throttled and a sleeping machine's do not run at all, so
    // the first thing a returning reader should see is the phase they are
    // actually in rather than the one the clock stopped on.
    document.addEventListener('visibilitychange', due);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', due);
    };
  }, [run]);

  return useMemo(
    () => ({ ...run, settings, start, stop, resume }),
    [run, settings, start, stop, resume]
  );
}

/** Seconds left of the stretch in hand, never negative. */
export function leftOf(endsAt: number, now = Date.now()): number {
  return Math.max(0, Math.round((endsAt - now) / 1000));
}
