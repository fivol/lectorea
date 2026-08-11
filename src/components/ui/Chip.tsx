import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import Icon, { type IconName } from '../Icon';
import { cx } from './cx';

type Props = {
  /** Holding a value: the accent inlay, the same one the view switch uses. */
  on?: boolean;
  /** Standing *for* a value — a filter someone switched on. Filled, not washed. */
  filled?: boolean;
  icon?: IconName;
  iconSize?: number;
  onClick?: () => void;
  /** A chip that leads somewhere — a domain tag pointing at its filtered list. */
  to?: string;
  title?: string;
  ariaLabel?: string;
  ariaExpanded?: boolean;
  className?: string;
  /** For the two chips that carry a domain's own hue rather than the palette's. */
  style?: CSSProperties;
  children: ReactNode;
};

/**
 * The small capsule: a filter, a tag, a count.
 *
 * A chip with an `onClick` is a button and a chip without one is a label, and
 * the markup follows — a `span` for a tag keeps it out of the tab order.
 */
export default function Chip({
  on = false,
  filled = false,
  icon,
  iconSize = 12,
  onClick,
  to,
  title,
  ariaLabel,
  ariaExpanded,
  className = '',
  style,
  children,
}: Props) {
  const classes = cx('chip', on && 'chip-on', filled && 'chip-active bg-accent text-canvas', className);
  const inner = (
    <>
      {icon ? <Icon name={icon} size={iconSize} /> : null}
      {children}
    </>
  );

  if (to) {
    return (
      <Link to={to} className={classes} title={title} aria-label={ariaLabel} style={style}>
        {inner}
      </Link>
    );
  }

  if (!onClick) {
    return (
      <span className={classes} title={title} style={style}>
        {inner}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={classes}
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      aria-expanded={ariaExpanded}
      style={style}
    >
      {inner}
    </button>
  );
}
