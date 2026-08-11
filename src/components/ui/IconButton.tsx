import type { ButtonHTMLAttributes, ReactNode } from 'react';
import Icon, { type IconName } from '../Icon';
import { cx } from './cx';

type Props = {
  icon?: IconName;
  iconSize?: number;
  /** Both the accessible name and the tooltip — a glyph alone never says enough. */
  label: string;
  tap?: boolean;
  /** For the rare glyph that is not one path: the theme toggle stacks two. */
  children?: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>;

/**
 * A glyph on its own: close, clear, back, toggle.
 *
 * Round, and with no fill or border of its own — it lives on a plate, on a
 * modal header or inside a field, all of which already provide both.
 */
export default function IconButton({
  icon,
  iconSize = 16,
  label,
  tap = false,
  className = '',
  children,
  type = 'button',
  ...rest
}: Props) {
  return (
    <button
      type={type}
      className={cx('icon-btn', tap && 'tap', className)}
      aria-label={label}
      title={label}
      {...rest}
    >
      {children ?? (icon ? <Icon name={icon} size={iconSize} /> : null)}
    </button>
  );
}
