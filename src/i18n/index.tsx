import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { formatHours, formatMinutes, hoursFromSeconds } from '@/lib/format';

/**
 * Localisation in thirty lines instead of i18next.
 *
 * Every user-facing string lives in data/i18n/{lang}.json and the code only ever
 * holds keys. Pluralisation is needed in a handful of places; a library is not
 * worth its weight for that.
 */

export type Dictionary = Record<string, string>;

type Params = Record<string, string | number>;

const I18nContext = createContext<{ lang: string; dict: Dictionary }>({
  lang: 'ru',
  dict: {},
});

export function I18nProvider({
  lang,
  dict,
  children,
}: {
  lang: string;
  dict: Dictionary;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ lang, dict }), [lang, dict]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole
  );
}

/** Russian plural categories. Other languages get the `many` form until they need better. */
export type PluralForm = 'one' | 'few' | 'many';

export function pluralForm(n: number, lang: string): PluralForm {
  const value = Math.abs(Math.trunc(n));
  if (lang !== 'ru') return value === 1 ? 'one' : 'many';
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return 'one';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few';
  return 'many';
}

export type Translator = {
  t: (key: string, params?: Params) => string;
  /** Just the noun in the right form: `plural(3, 'course')` → «курса». */
  plural: (n: number, noun: string) => string;
  /** Number and noun together: `count(3, 'course')` → «3 курса». */
  count: (n: number, noun: string) => string;
  /**
   * A stretch of time in whatever unit it is actually in, as the number and its
   * noun apart — a tile prints them on two lines, a sentence in one breath.
   */
  span: (seconds: number) => Span;
  /** True when the key is missing — lets a caller fall back instead of showing the key. */
  has: (key: string) => boolean;
  lang: string;
};

export type Span = { value: string; noun: string; text: string };

export function useT(): Translator {
  const { lang, dict } = useContext(I18nContext);

  const t = useCallback(
    (key: string, params?: Params) => {
      const template = dict[key];
      // A missing key shows as the key itself: loud in development, harmless in
      // production, and check:i18n keeps it from ever reaching a build.
      return template === undefined ? key : interpolate(template, params);
    },
    [dict]
  );

  const plural = useCallback(
    (n: number, noun: string) => t(`ui.plural.${noun}.${pluralForm(n, lang)}`),
    [t, lang]
  );

  const count = useCallback(
    (n: number, noun: string) => `${formatNumber(n, lang)} ${plural(n, noun)}`,
    [plural, lang]
  );

  /*
   * Under an hour the answer is minutes: «0,7 часа» is a number nobody reads as
   * forty minutes, and the first week of a habit is spent entirely below the
   * hour mark.
   *
   * The noun is read back off the printed number rather than the raw one. Past
   * ten hours the decimal is dropped, and «12 часа» would be the reward for
   * pluralising what was measured instead of what is shown. A fraction takes
   * the genitive singular in Russian — «1,5 часа» — which is the form 2 to 4
   * take, so it is pluralised as if it were two.
   */
  const span = useCallback(
    (seconds: number): Span => {
      const say = (value: string, noun: string): Span => ({
        value,
        noun,
        text: `${value} ${noun}`,
      });
      if (seconds < 3600) {
        const minutes = formatMinutes(seconds);
        return say(String(minutes), plural(minutes, 'minute'));
      }
      const printed = formatHours(hoursFromSeconds(seconds));
      const shown = Number(printed);
      return say(printed, plural(Number.isInteger(shown) ? shown : 2, 'hour'));
    },
    [plural]
  );

  const has = useCallback((key: string) => key in dict, [dict]);

  return useMemo(
    () => ({ t, plural, count, span, has, lang }),
    [t, plural, count, span, has, lang]
  );
}

export function formatNumber(n: number, lang = 'ru'): string {
  return new Intl.NumberFormat(lang === 'ru' ? 'ru-RU' : 'en-US').format(n);
}

/** 1_240_000 → «1,2 млн». Raw counts in a list turn it into a spreadsheet. */
export function formatCompact(n: number, lang = 'ru'): string {
  return new Intl.NumberFormat(lang === 'ru' ? 'ru-RU' : 'en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(n);
}
