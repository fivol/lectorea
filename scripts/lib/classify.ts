import type { Completeness, PlaylistKind } from '../../shared/schema.js';

/**
 * Heuristics that turn a YouTube title into catalogue metadata.
 *
 * They live in the build rather than in the crawler on purpose: a wrong guess
 * is then fixed by editing the regex and re-running `data:build`, which costs
 * nothing, instead of re-crawling and spending a day of quota.
 * Anything they get wrong is corrected by hand in `overrides.yaml`.
 */

const LECTURE_RE = /(?:^|\W)(лекци\w*|lectures?|lec)(?:\W|$)/i;
const SEMINAR_RE =
  /(?:^|\W)(семинар\w*|практик\w*|упражнени\w*|seminars?|recitation|problem session|tutorial|discussion section)(?:\W|$)/i;

/**
 * Share of the lectures that must say what they are before the playlist does.
 *
 * A course whose seventh video is called «Семинар 7» has answered the question
 * about itself; one where a single video happens to mention a tutorial has not.
 * `mixed` needs less from each side by construction — it is the claim that both
 * are present, not that either dominates.
 */
const KIND_SHARE = { clear: 0.6, present: 0.2 } as const;

/**
 * Whether a playlist is lectures or seminars, read off its lectures' own names.
 *
 * It used to be read off the playlist's title and description alone, and that
 * left 90% of the catalogue at «неизвестно» — a filter offering three values
 * that between them described 297 playlists out of 2902. The lecture titles are
 * fetched anyway and ship with the shard, and they are the place where the
 * distinction is actually written down: counting them finds four times as many
 * seminar series and two and a half times as many lecture courses.
 *
 * The playlist's own title still speaks when the videos have nothing to say —
 * «Доп. семинары "Механика"» is a clear answer whatever its videos are called.
 */
export function detectKind(title: string, description = '', videoTitles: string[] = []): PlaylistKind {
  const text = `${title} ${description}`;
  if (videoTitles.length >= 5) {
    let lectures = 0;
    let seminars = 0;
    for (const videoTitle of videoTitles) {
      if (LECTURE_RE.test(videoTitle)) lectures++;
      if (SEMINAR_RE.test(videoTitle)) seminars++;
    }
    const lectureShare = lectures / videoTitles.length;
    const seminarShare = seminars / videoTitles.length;
    if (lectureShare >= KIND_SHARE.present && seminarShare >= KIND_SHARE.present) return 'mixed';
    if (seminarShare >= KIND_SHARE.clear) return 'seminars';
    if (lectureShare >= KIND_SHARE.clear) return 'lectures';
  }
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

/**
 * The same name written out — «Биохимия - Асеев Виктор Васильевич», which is
 * how МГУ names every one of its recordings.
 *
 * The patronymic is what makes this safe to guess at: three capitalised words
 * in a row are a lecturer only occasionally, but three where the last ends in
 * -ович/-евна are a lecturer nearly always. Written back in the short form, so
 * the lecturer filter is not half «Асеев В.В.» and half «Асеев Виктор
 * Васильевич» for the same person.
 */
// The trailing lookahead rather than `\b`: JavaScript's word boundary is ASCII,
// so it never fires after «Васильевич» and the pattern silently matched nothing.
const FULL_NAME_RE =
  /(?:^|[—–\-,|]\s*)([А-ЯЁ][а-яё]+)\s+([А-ЯЁ])[а-яё]+\s+([А-ЯЁ])[а-яё]*(?:ович|евич|ьич|овна|евна|ична|инична)(?!\p{L})/u;

/**
 * The other order, which is how ИТМО writes every one of its titles:
 * «[s1 | 2025] Линейная алгебра, А. И. Трифанов».
 *
 * Worth its own pattern rather than a looser one: 18 recordings of linear
 * algebra alone are named this way, and each of them was showing the lecturer
 * as part of the recording's name because the field beside it was empty.
 */
const REVERSED_RE = /(?:^|[—–\-,|]\s*)([А-ЯЁ])\.\s*([А-ЯЁ])\.\s*([А-ЯЁ][а-яё]+)(?!\p{L})/u;
const REVERSED_FULL_RE =
  /(?:^|[—–\-,|]\s*)([А-ЯЁ])[а-яё]+\s+([А-ЯЁ])[а-яё]*(?:ович|евич|ьич|овна|евна|ична|инична)\s+([А-ЯЁ][а-яё]+)(?!\p{L})/u;

export function detectLecturer(title: string): string | undefined {
  // «А. М.» and «А.М.» are one lecturer, and the filter lists whatever this
  // returns — so the spacing is decided here rather than by the title.
  const match = NAME_RE.exec(title);
  if (match) return `${match[1]} ${match[2].replace(/\s+/g, '')}`;
  const full = FULL_NAME_RE.exec(title);
  if (full) return `${full[1]} ${full[2]}.${full[3]}.`;
  const reversed = REVERSED_RE.exec(title) ?? REVERSED_FULL_RE.exec(title);
  if (reversed) return `${reversed[3]} ${reversed[1]}.${reversed[2]}.`;
  return undefined;
}
