import { useMemo } from 'react';
import { useT } from '@/i18n';
import { offeredRates } from '@/lib/youtube';

/**
 * How fast the lecture runs, as buttons.
 *
 * YouTube has this in its own menu and on `Shift + .`, and neither is reachable
 * here: the embed is a cross-origin frame, so it only sees a key press while it
 * holds focus — and a page cannot hand a key to another origin. The keyboard is
 * dealt with in `useYouTubePlayer`, which takes focus back out of the frame; a
 * strip of buttons is the half that needs no focus at all.
 *
 * The rates are the player's own list rather than ours (see `FALLBACK_RATES`),
 * so a button cannot promise a speed the player would round down on the quiet.
 *
 * **Not `Segmented`, and not a menu.** The kit's switch is a plate with an
 * accent slab sliding under the chosen half, and under a video that is the
 * loudest thing on the screen — a setting somebody picks once, shouting over
 * the lecture. Folding it into a chip that opens a list quietened it and cost a
 * press on every change, which is the wrong trade for a control reached
 * mid-sentence. So it stays a row of buttons and gives up the plate instead:
 * bare numerals in the player's own furniture, the current one accented and set
 * in medium so the colour is not the only thing carrying it.
 */
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
  const offered = useMemo(() => offeredRates(rates, rate), [rates, rate]);

  return (
    <div
      role="group"
      aria-label={t('ui.player.speed')}
      title={t('ui.player.speed')}
      className="scroll-x-plain flex min-w-0 items-center gap-0.5"
    >
      {offered.map((value) => {
        const on = value === rate;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(value)}
            className={`num shrink-0 px-2 py-1 text-[11px] leading-none
                        transition-colors duration-fast ease-out
                        ${on ? 'font-semibold text-accent' : 'text-ink-faint hover:text-ink'}`}
          >
            {value.toLocaleString(lang)}×
          </button>
        );
      })}
    </div>
  );
}
