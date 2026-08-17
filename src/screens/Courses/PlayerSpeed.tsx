import { useMemo } from 'react';
import { useT } from '@/i18n';
import { offeredRates } from '@/lib/youtube';
import { Segmented } from '@/components/ui';

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
