import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import Icon, { type IconName } from '../Icon';
import { cx } from './cx';

/**
 * The plate: the material every floating control is cut from.
 *
 * A capsule with a lit top edge and a shadow under it, always a shade lighter
 * than whatever it lies on — the same two devices that make a continent read as
 * a slab on the water rather than as a hole cut through it.
 *
 * `row` turns it into a holder for several controls, which is the point of the
 * thing: a header with four separate plates in it is a toolbar, and grouping
 * what belongs together is what stops it looking like one.
 */
export default function Plate({
  row = false,
  className = '',
  children,
  ...rest
}: {
  row?: boolean;
  className?: string;
  children: ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('plate', row && 'plate-row', className)} {...rest}>
      {children}
    </div>
  );
}

/** The hairline between two controls sharing one plate. */
export function PlateDivider() {
  return <span className="plate-divider" aria-hidden="true" />;
}

/**
 * A single control that is its own plate — the way back to the map, and
 * anything else that is one word of navigation rather than an action.
 *
 * Set in the map's own lettering: mono, spaced caps. `to` makes it a link,
 * `onClick` a button; it has to be one or the other.
 */
export function Cap({
  to,
  onClick,
  icon,
  label,
  ariaLabel,
  className = '',
}: {
  to?: string;
  onClick?: () => void;
  icon?: IconName;
  label: ReactNode;
  ariaLabel?: string;
  className?: string;
}) {
  const classes = cx('plate plate-cap tap text-ink-dim hover:text-ink', className);
  const inner = (
    <>
      {icon ? <Icon name={icon} size={13} /> : null}
      {label}
    </>
  );

  return to ? (
    <Link to={to} className={classes} aria-label={ariaLabel}>
      {inner}
    </Link>
  ) : (
    <button type="button" className={classes} onClick={onClick} aria-label={ariaLabel}>
      {inner}
    </button>
  );
}
