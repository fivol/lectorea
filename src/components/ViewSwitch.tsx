import { useT } from '@/i18n';
import Icon, { type IconName } from './Icon';

type View = 'map' | 'blocks';

const ITEMS: Array<{ id: View; icon: IconName; key: string }> = [
  { id: 'map', icon: 'map', key: 'ui.view.map' },
  { id: 'blocks', icon: 'grid', key: 'ui.view.blocks' },
];

/**
 * Map or blocks — the same catalogue, drawn twice.
 *
 * A sliding pill rather than two independently highlighted halves: the two
 * views are one thing seen two ways, and a state that travels between them says
 * that in a way two lit rectangles never do.
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
  const index = ITEMS.findIndex((item) => item.id === value);

  return (
    <div className={`plate seg ${className}`} role="group" aria-label={t('ui.view.switch')}>
      {/* The pill is one element under both halves, so the browser animates a
          single transform instead of cross-fading two backgrounds. */}
      <span
        className="seg-thumb"
        style={{ transform: `translateX(${Math.max(index, 0) * 100}%)` }}
        aria-hidden="true"
      />
      {ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          className="seg-item"
          onClick={() => onChange(item.id)}
          aria-pressed={value === item.id}
        >
          <Icon name={item.icon} size={13} />
          {t(item.key)}
        </button>
      ))}
    </div>
  );
}
