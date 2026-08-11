import { useT } from '@/i18n';
import { Switch, type SwitchOption } from './ui';

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
  className = '',
}: {
  value: View;
  onChange: (next: View) => void;
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
      className={className}
    />
  );
}
