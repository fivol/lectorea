import { useMemo } from 'react';
import { useT } from '@/i18n';
import { offeredRates } from '@/lib/youtube';
import Dropdown, { Caption, RadioRow } from '@/components/Dropdown';

/**
 * How fast the lecture runs.
 *
 * YouTube has this in its own menu and on `Shift + .`, and neither is reachable
 * here: the embed is a cross-origin frame, so it only sees a key press while it
 * holds focus — and a page cannot hand a key to another origin. The keyboard is
 * dealt with in `useYouTubePlayer`, which takes focus back out of the frame; a
 * control that needs no focus at all is the other half.
 *
 * It is one chip saying what the speed is, and it used to be the whole ladder
 * of them — eight buttons on a plate with the current one lit in the accent,
 * under a video, which is a lot of furniture for a setting somebody changes
 * once and keeps for a term. As a chip it says «1,25×» quietly and turns accent
 * only when the speed is not 1×, which is the one state worth noticing from
 * across the screen. Where it opens, it is still one press per rate.
 *
 * The rates are the player's own list rather than ours (see `FALLBACK_RATES`),
 * so a row cannot promise a speed the player would round down on the quiet.
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
  const say = (value: number): string => `${value.toLocaleString(lang)}×`;

  return (
    <Dropdown
      label={<span className="num">{say(rate)}</span>}
      title={t('ui.player.speed')}
      active={rate !== 1}
    >
      {/* The list is a column of «1,25×» and nothing else, so it says what it
          is a list of — the trigger's own word is the value. */}
      <Caption>{t('ui.player.speed')}</Caption>
      {offered.map((value) => (
        <RadioRow key={value} checked={value === rate} onChange={() => onPick(value)}>
          <span className="num">{say(value)}</span>
        </RadioRow>
      ))}
    </Dropdown>
  );
}
