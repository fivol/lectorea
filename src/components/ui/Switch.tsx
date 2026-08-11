import Icon, { type IconName } from '../Icon';
import { cx } from './cx';

export type SwitchOption<T extends string> = {
  value: T;
  label: string;
  icon?: IconName;
};

/**
 * Two or three views of the same thing, with the state sliding between them.
 *
 * The movement is the argument: a pill that travels says these are one thing
 * seen two ways, which two independently lit halves never manage. It costs one
 * transform, and the halves are equal by construction — with labels of
 * different widths the pill would have to be measured, which is what
 * `Segmented` is for.
 *
 * Set in the map's own lettering, mono and spaced caps, because this is chrome
 * steering the map rather than content inside it.
 */
export default function Switch<T extends string>({
  value,
  options,
  onChange,
  label,
  className = '',
}: {
  value: T;
  options: Array<SwitchOption<T>>;
  onChange: (next: T) => void;
  /** Names the group for a screen reader — «Переключить вид». */
  label?: string;
  className?: string;
}) {
  const index = Math.max(
    options.findIndex((option) => option.value === value),
    0
  );
  const n = options.length;

  return (
    <div className={cx('plate seg', className)} role="group" aria-label={label}>
      {/* One element under all the halves, so the browser animates a single
          transform instead of cross-fading n backgrounds. */}
      <span
        className="seg-thumb"
        style={{
          width: `calc(100% / ${n} - ${4 / n}px)`,
          transform: `translateX(${index * 100}%)`,
        }}
        aria-hidden="true"
      />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="seg-item"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
        >
          {option.icon ? <Icon name={option.icon} size={13} /> : null}
          {option.label}
        </button>
      ))}
    </div>
  );
}
