import { useEffect, useMemo } from 'react';
import { useT } from '@/i18n';
import { Segmented } from '@/components/ui';

/**
 * How fast the lecture runs, as buttons.
 *
 * YouTube has this in its own menu and on `Shift + .`, and neither is reachable
 * here: the embed is a cross-origin frame, so it only sees a key press while it
 * holds focus — which it loses to the first thing of ours the reader touches,
 * and never has at all right after the player opens. A speed control that works
 * has to be on this side of the boundary, which is what this is.
 *
 * The rates are the player's own list rather than ours (see `FALLBACK_RATES`),
 * so a button cannot promise a speed the player would round down on the quiet.
 * Anything under half speed is dropped: it is a different activity from
 * watching a lecture, and four buttons nobody presses push the useful ones off
 * a phone.
 */
const FLOOR = 0.5;

export default function PlayerSpeed({
  rate,
  rates,
  onPick,
}: {
  rate: number;
  rates: number[];
  onPick: (rate: number) => void;
}) {
  const { t, lang } = useT();

  // Whatever is actually playing stays on the strip even when it is below the
  // floor: a control that hides the state it is in is worse than a long strip.
  const offered = useMemo(
    () => rates.filter((value) => value >= FLOOR || value === rate),
    [rates, rate]
  );

  /**
   * The keys YouTube uses, on our side of the frame.
   *
   * By `code` *and* by character. `code` is the physical key, which is what
   * makes `Shift + >` work on the Russian layout, where that key types `Ю` and
   * a character test would never fire — the same class of miss the letter
   * shortcuts avoid by listing both alphabets. The character is the fallback
   * for the events that carry no `code` at all. Ignored while anything is being
   * typed into, like every other shortcut in the app.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
      const faster = event.code === 'Period' || event.key === '>' || event.key === '.';
      const slower = event.code === 'Comma' || event.key === '<' || event.key === ',';
      const step = faster ? 1 : slower ? -1 : 0;
      if (!step) return;
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable)
        return;

      // From where the player actually is, which after a rate it refused is not
      // where the last press left us.
      const nearest = offered.reduce(
        (best, value, index) =>
          Math.abs(value - rate) < Math.abs(offered[best] - rate) ? index : best,
        0
      );
      const next = offered[Math.min(offered.length - 1, Math.max(0, nearest + step))];
      if (next === undefined || next === rate) return;
      event.preventDefault();
      onPick(next);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [offered, rate, onPick]);

  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
      <Segmented
        className="num"
        label={t('ui.player.speed')}
        value={String(rate)}
        options={offered.map((value) => ({
          value: String(value),
          label: `${value.toLocaleString(lang)}×`,
        }))}
        onChange={(value) => onPick(Number(value))}
      />
    </div>
  );
}
