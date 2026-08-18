/**
 * Which plural form a number takes, per language.
 *
 * In `shared/` rather than in the i18n module because there are two consumers
 * and they cannot import each other: the interface asks at runtime, and
 * `scripts/prerender.ts` asks at build time to write «225 курсов» into a page
 * that has to be right before any JavaScript runs. Two copies of this rule
 * would be two copies that drift, and the one in the pages is the one search
 * engines read.
 */
export type PluralForm = 'one' | 'few' | 'many';

/** Russian plural categories. Other languages get the `many` form until they need better. */
export function pluralForm(n: number, lang: string): PluralForm {
  const value = Math.abs(Math.trunc(n));
  if (lang !== 'ru') return value === 1 ? 'one' : 'many';
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return 'one';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few';
  return 'many';
}
