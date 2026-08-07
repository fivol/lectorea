import type { Completeness, PlaylistKind } from '../../shared/schema.js';

/**
 * Heuristics that turn a YouTube title into catalogue metadata.
 *
 * They live in the build rather than in the crawler on purpose: a wrong guess
 * is then fixed by editing the regex and re-running `data:build`, which costs
 * nothing, instead of re-crawling and spending a day of quota.
 * Anything they get wrong is corrected by hand in `overrides.yaml`.
 */

const LECTURE_RE = /\b(лекци|лекция|lecture|lectures|курс лекций)\b/i;
const SEMINAR_RE = /\b(семинар|практик|упражнени|seminar|recitation|problem session|tutorial)\b/i;

export function detectKind(title: string, description = ''): PlaylistKind {
  const text = `${title} ${description}`;
  const lectures = LECTURE_RE.test(text);
  const seminars = SEMINAR_RE.test(text);
  if (lectures && seminars) return 'mixed';
  if (lectures) return 'lectures';
  if (seminars) return 'seminars';
  return 'unknown';
}

const FULL_RE = /\b(полный курс|full course|complete course|весь курс)\b/i;
const PARTIAL_RE = /\b(фрагмент|отрывк|избранн|selected|highlights)\b/i;

/**
 * A semester course is roughly 12–30 recordings. Anything much shorter is a
 * fragment; the exact boundary is a judgement call, which is why it is one
 * constant and not a formula.
 */
export function detectCompleteness(
  title: string,
  videoCount: number,
  description = ''
): Completeness {
  const text = `${title} ${description}`;
  if (FULL_RE.test(text)) return 'full';
  if (PARTIAL_RE.test(text)) return 'partial';
  if (videoCount >= 12) return 'full';
  if (videoCount <= 5) return 'partial';
  return 'unknown';
}

const CYRILLIC_RE = /[а-яё]/i;

export function detectLang(title: string, fallback = 'ru'): string {
  if (CYRILLIC_RE.test(title)) return 'ru';
  if (/[a-z]/i.test(title)) return 'en';
  return fallback;
}

/**
 * Pulls a lecturer name out of a title like
 * «Теория вероятностей — МФТИ, Райгородский А. М.»
 * Deliberately conservative: a wrong name is worse than no name, because the
 * lecturer filter is built from these values.
 */
const NAME_RE = /(?:^|[—–\-,|]\s*)([А-ЯЁ][а-яё]+(?:ов|ев|ин|ский|цкий|ко|ян|ич|ук|юк|ай|ей)?)\s+([А-ЯЁ]\.\s*[А-ЯЁ]\.)/;

export function detectLecturer(title: string): string | undefined {
  const match = NAME_RE.exec(title);
  if (!match) return undefined;
  return `${match[1]} ${match[2].replace(/\s+/g, ' ').trim()}`;
}
