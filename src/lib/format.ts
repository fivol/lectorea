import { hexToHsl, hslToHex } from '@shared/procedural';

/** Formatting helpers shared across the screens. */

export function hoursFromSeconds(seconds: number): number {
  return Math.round((seconds / 3600) * 10) / 10;
}

/**
 * `5040` → `1:24:00`, `320` → `5:20`. Lecture lengths read better as clock time.
 * An hour-long lecture keeps its seconds: `1:24` alone reads as a minute and a
 * half just as easily as an hour and a half, and the third group settles it.
 */
export function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return '—';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = Math.floor(seconds % 60);
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}

export function formatHours(hours: number): string {
  if (hours >= 100) return String(Math.round(hours));
  if (hours >= 10) return String(Math.round(hours));
  return hours.toFixed(1).replace(/\.0$/, '');
}

export function formatMinutes(seconds: number): number {
  return Math.round(seconds / 60);
}

export function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export function formatDate(iso: string, lang = 'ru'): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(lang === 'ru' ? 'ru-RU' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

/** The card a domain colour is printed on — what the contrast is measured against. */
const CARD = { dark: '#111726', light: '#ffffff' } as const;
const AA = 4.5;

function relativeLuminance(hex: string): number {
  const value = hex.replace('#', '');
  const channel = (at: number): number => {
    const srgb = parseInt(value.slice(at, at + 2), 16) / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

function contrast(a: string, b: string): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/**
 * A domain hue, adjusted to the canvas it is drawn on.
 *
 * One palette serves both schemes and both jobs, so it is bent at the point of
 * use rather than duplicated. A domain's colour is its biome's — basalt, taiga,
 * flint — chosen to be a *territory* on a map, which is a large shape with a
 * border round it. As four words of text on a card it has to clear 4.5:1, and a
 * biome ramp reaches both ends of the range that fails: dark stone vanishes into
 * the night canvas, pale chalk into the day one. So the hue is walked the one
 * way it needs to go until it clears, and no further — a colour that already
 * clears is handed straight back.
 *
 * Walked against the real ratio rather than to a fixed lightness, because
 * lightness is not contrast: the same HSL value is a legible violet and an
 * illegible yellow, and a palette with a gold in it makes the difference
 * visible.
 */
export function inkOn(hex: string, scheme: 'dark' | 'light'): string {
  const card = CARD[scheme];
  if (contrast(hex, card) >= AA) return hex;

  const { h, s, l } = hexToHsl(hex);
  // Saturation is nudged up on the day scheme only: deepening a hue there drains
  // it, and a domain colour that arrives as grey has stopped being one.
  const saturation = scheme === 'light' ? Math.min(1, s + 0.08) : s;
  const step = scheme === 'dark' ? 0.02 : -0.02;
  let lightness = l;
  let ink = hslToHex({ h, s: saturation, l: lightness });
  while (contrast(ink, card) < AA && lightness > 0 && lightness < 1) {
    lightness = clamp(lightness + step, 0, 1);
    ink = hslToHex({ h, s: saturation, l: lightness });
  }
  return ink;
}

/** Mixes a colour with the canvas so a domain hue can fade without alpha stacking. */
export function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const value = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgb(${r} ${g} ${b} / ${alpha})`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
