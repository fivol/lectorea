import { cx } from './cx';

export type SegmentedOption<T extends string> = { value: T; label: string };

/**
 * The same idea as `Switch`, for options whose labels are all different widths:
 * «Авто · Светлая · Тёмная», the five tabs of the profile. The chosen one takes
 * the accent inlay where it stands instead of a pill sliding under it — a pill
 * that has to be measured before it can move is a resize observer for no gain.
 *
 * `kind` decides what the group *is*: a tab list switching panels, or a set of
 * pressed states for one setting. It changes the roles, not the look.
 */
export default function Segmented<T extends string>({
  value,
  options,
  onChange,
  kind = 'group',
  label,
  className = '',
}: {
  value: T;
  options: Array<SegmentedOption<T>>;
  onChange: (next: T) => void;
  kind?: 'group' | 'tabs';
  label?: string;
  className?: string;
}) {
  const tabs = kind === 'tabs';

  return (
    <div
      className={cx('plate plate-row scroll-x-plain w-fit max-w-full', className)}
      role={tabs ? 'tablist' : 'group'}
      aria-label={label}
    >
      {options.map((option) => {
        const chosen = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            className="tab"
            role={tabs ? 'tab' : undefined}
            aria-selected={tabs ? chosen : undefined}
            aria-pressed={tabs ? undefined : chosen}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
