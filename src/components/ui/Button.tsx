import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import Icon, { type IconName } from '../Icon';
import { cx } from './cx';

type Variant = 'default' | 'primary' | 'danger' | 'ghost';

const VARIANT: Record<Variant, string> = {
  default: 'btn',
  primary: 'btn btn-primary',
  danger: 'btn btn-danger',
  // A ghost is a word that acts, not a plate: no fill and no border until the
  // pointer is on it. For «Сбросить всё» next to a row of chips, a second plate
  // would read as one more filter.
  ghost: 'btn-ghost',
};

type Props = {
  variant?: Variant;
  /** 13px instead of 14px — for a button that sits inside a list row or a caption. */
  small?: boolean;
  icon?: IconName;
  iconSize?: number;
  /** A 44×44 minimum on coarse pointers. */
  tap?: boolean;
  children?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>;

/**
 * The pressable capsule, in four weights: plain, accent, destructive, ghost.
 *
 * Everything that can be pressed is a capsule — the map is drawn out of round
 * shapes and a rounded rectangle in the middle of it reads as a piece of some
 * other product.
 */
export default function Button({
  variant = 'default',
  small = false,
  icon,
  iconSize = 14,
  tap = false,
  className = '',
  children,
  type = 'button',
  ...rest
}: Props) {
  return (
    <button
      type={type}
      className={cx(VARIANT[variant], small && 'text-xs', tap && 'tap', className)}
      {...rest}
    >
      {icon ? <Icon name={icon} size={iconSize} /> : null}
      {children}
    </button>
  );
}

/**
 * The same capsule, for something that navigates rather than acts: `to` for a
 * route, `href` for the outside world. An anchor styled as a button is right
 * here and a button that navigates is not — middle-click and «open in a new
 * tab» are the difference, and on a link to YouTube they matter.
 */
export function ButtonLink({
  to,
  href,
  variant = 'default',
  small = false,
  icon,
  iconSize = 14,
  className = '',
  children,
  ...rest
}: {
  to?: string;
  href?: string;
  variant?: Variant;
  small?: boolean;
  icon?: IconName;
  iconSize?: number;
  className?: string;
  children?: ReactNode;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'className'>) {
  const classes = cx(VARIANT[variant], small && 'text-xs', className);
  const inner = (
    <>
      {icon ? <Icon name={icon} size={iconSize} /> : null}
      {children}
    </>
  );

  return to ? (
    <Link to={to} className={classes} {...rest}>
      {inner}
    </Link>
  ) : (
    <a href={href} className={classes} target="_blank" rel="noreferrer noopener" {...rest}>
      {inner}
    </a>
  );
}
