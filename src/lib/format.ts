/** Formatting helpers shared across the screens. */

export function hoursFromSeconds(seconds: number): number {
  return Math.round((seconds / 3600) * 10) / 10;
}

/** `5040` → `1:24`, `320` → `5:20`. Lecture lengths read better as clock time. */
export function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return '—';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = Math.floor(seconds % 60);
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}`
    : `${minutes}:${String(rest).padStart(2, '0')}`;
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
