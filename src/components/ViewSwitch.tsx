import { useT } from '@/i18n';
import { IconButton, Plate, Switch, type SwitchOption } from './ui';

type View = 'map' | 'blocks';

/**
 * Map or blocks — the same catalogue, drawn twice.
 *
 * The only thing this adds to `Switch` is what the two halves are called; the
 * sliding pill, the plate and the lettering are the kit's.
 */
export default function ViewSwitch({
  value,
  onChange,
  large = false,
  className = '',
}: {
  value: View;
  onChange: (next: View) => void;
  /** The thumb-sized flavour, for the one that floats at the foot of a phone. */
  large?: boolean;
  className?: string;
}) {
  const { t } = useT();

  const options: Array<SwitchOption<View>> = [
    { value: 'map', label: t('ui.view.map'), icon: 'map' },
    { value: 'blocks', label: t('ui.view.blocks'), icon: 'grid' },
  ];

  return (
    <Switch
      value={value}
      options={options}
      onChange={onChange}
      label={t('ui.view.switch')}
      large={large}
      className={className}
    />
  );
}

/**
 * The same choice as one glyph, for a row with no width to spare.
 *
 * A phone's top is the wordmark, the search field and — before this — a
 * two-word switch on a band of its own, three deep over a drawing whose first
 * names start below all of them. The switch is not worth a band: it says the
 * same thing the icon does, and the icon fits in the row that already exists.
 *
 * It shows **where the press leads** rather than where you are, which is the
 * rule the theme and language buttons in the corner follow, and the reason one
 * glyph can stand for two states without a label under it.
 */
export function ViewToggle({
  value,
  onChange,
  className = '',
}: {
  value: View;
  onChange: (next: View) => void;
  className?: string;
}) {
  const { t } = useT();
  const next: View = value === 'map' ? 'blocks' : 'map';

  return (
    <Plate row className={className}>
      <IconButton
        icon={next === 'map' ? 'map' : 'grid'}
        label={t(next === 'map' ? 'ui.view.map' : 'ui.view.blocks')}
        onClick={() => onChange(next)}
      />
    </Plate>
  );
}
