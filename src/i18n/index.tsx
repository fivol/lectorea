import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';

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
  /** True when the key is missing — lets a caller fall back instead of showing the key. */
  has: (key: string) => boolean;
  lang: string;
};

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

  const has = useCallback((key: string) => key in dict, [dict]);

  return useMemo(() => ({ t, plural, count, has, lang }), [t, plural, count, has, lang]);
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
