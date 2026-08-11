import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { cx } from './cx';

/**
 * A row that holds an input and whatever stands beside it — a glyph, a clear
 * button, a keyboard hint. The capsule and the accent ring on focus belong to
 * this, not to the `input` inside it, so the whole row lights up together.
 *
 * `floating` is the one that hangs over the map, where there is open water
 * behind it rather than a page.
 */
export function Field({
  floating = false,
  className = '',
  children,
}: {
  floating?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return <div className={cx('field', floating && 'field-floating', className)}>{children}</div>;
}

/** A bare input that is its own field — the search line inside a popover. */
export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx('input', className)} {...rest} />;
}

/** More than a line, so it keeps the card's corner rather than the capsule's. */
export function Textarea({
  className = '',
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx('field-area', className)} {...rest} />;
}

/** A native select, dressed as a field. */
export function Select({ className = '', ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx('select', className)} {...rest} />;
}

/** A key, drawn as one. */
export function Kbd({ className = '', children }: { className?: string; children: ReactNode }) {
  return <kbd className={cx('kbd', className)}>{children}</kbd>;
}
