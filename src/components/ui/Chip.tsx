import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import Icon, { type IconName } from '../Icon';
import Tooltip from '../Tooltip';
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
  /**
   * What the chip means, in a sentence. A chip that says «2 курс» or
   * «Сложность 5» names a value without saying what the value is of, and the
   * legend that explains it is three screens away by the time the question
   * comes up.
   */
  hint?: ReactNode;
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
  hint,
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

  // The tooltip goes around the finished element rather than inside each branch:
  // it clones whatever it is given, and a link, a button and a span all take the
  // handlers the same way.
  //
  // `tap` follows the same split the markup does. A label answers nothing when
  // it is pressed, so on a phone the press is free and it is the only way the
  // sentence can be read at all; a chip that leads somewhere or does something
  // has a press of its own, and the bubble does not get to take it.
  const explained = (chip: ReactElement, tap = false) =>
    hint ? (
      <Tooltip content={hint} tap={tap}>
        {chip}
      </Tooltip>
    ) : (
      chip
    );

  if (to) {
    return explained(
      <Link to={to} className={classes} title={title} aria-label={ariaLabel} style={style}>
        {inner}
      </Link>
    );
  }

  if (!onClick) {
    return explained(
      <span className={cx(classes, hint ? 'cursor-help' : undefined)} title={title} style={style}>
        {inner}
      </span>,
      true
    );
  }

  return explained(
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
