/**
 * Class names, joined. Falsy parts drop out, so a conditional class is written
 * as `cx('chip', active && 'chip-on')` rather than as a ternary with an empty
 * string in it.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
