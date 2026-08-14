import type { Series } from '../../shared/schema.js';

/**
 * Finds the runs: recordings that are one course cut into parts.
 *
 * A university that splits a subject publishes the halves as separate
 * playlists, and from the outside they look exactly like the three unrelated
 * recordings of the same course that the catalogue is otherwise full of. The
 * difference is that the halves agree on everything except a number.
 *
 * So a run is: one channel, one title once the number is taken out, and at
 * least two different numbers. Measured over the crawl, that finds 155 runs
 * across 494 playlists — 126 of them of two parts, which is what the split
 * usually is. Everything else that carries a number in its title is a year, a
 * stream, or a re-recording, and gets left alone.
 *
 * The season case is the one that has to be argued rather than matched.
 * «Осень» and «весна» mark a part only inside one academic year; across years
 * they mark two recordings of the same course, and 23 of the 48 season pairs in
 * the crawl are exactly that — `MIT 6.006, Fall 2011` next to `Spring 2020`.
 * Hence the year test below.
 */

type Input = {
  id: string;
  channelId: string;
  title: string;
  /** Recording year, used only to tell a season pair from a re-recording. */
  year?: number;
};

type Mark = { kind: string; pos: number };

const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6 };

/**
 * The number in a title, and what it was written as.
 *
 * Order matters: an explicit «часть 2» outranks a trailing «2», and both
 * outrank a season, because a title that says both («Часть 2, весна 2021»)
 * means the part and mentions the term.
 */
export function partMark(title: string): Mark | null {
  const s = title.toLowerCase().replace(/ё/g, 'е');
  let m: RegExpMatchArray | null;

  if (
    (m = s.match(/част[ья]\s*[№#]?\s*([1-9])(?![\d])/)) ||
    (m = s.match(/([1-9])\s*-?\s*[ья]?\s*част[ья]/)) ||
    (m = s.match(/(?:^|[^\p{L}])ч\.\s*([1-9])(?![\d])/u)) ||
    (m = s.match(/(?:^|[^\p{L}])(?:part|pt)\.?\s*([1-9])(?![\d])/u))
  ) {
    return { kind: 'часть', pos: Number(m[1]) };
  }
  if ((m = s.match(/(?:^|[^\p{L}])part\s+(i{1,3}|iv|vi?)(?![\p{L}])/u))) {
    return { kind: 'часть', pos: ROMAN[m[1]] };
  }
  if (
    (m = s.match(/\[\s*s\s*([1-9])\s*[\]|]/)) ||
    (m = s.match(/([1-9])\s*-?\s*(?:й|ый|ой)?\s*семестр(?![\p{L}])/u)) ||
    (m = s.match(/семестр\s*[№#]?\s*([1-9])(?![\d])/))
  ) {
    return { kind: 'семестр', pos: Number(m[1]) };
  }
  if ((m = s.match(/(?:^|[^\p{L}])(?:сезон|season)\s*([1-9])(?![\d])/u))) {
    return { kind: 'сезон', pos: Number(m[1]) };
  }
  if (
    (m = s.match(/(?:^|[^\p{L}])(?:модул[ья]|блок|раздел|уровень|module|level)\s*[№#]?\s*([1-9])(?![\d])/u))
  ) {
    return { kind: 'модуль', pos: Number(m[1]) };
  }
  if ((m = s.match(/(?:^|[^\p{L}\d])(i{2,3}|iv|vi)\s*$/u))) {
    return { kind: 'часть', pos: ROMAN[m[1]] };
  }
  // A bare trailing number is the weakest of these and the most common. It only
  // ever groups titles that are otherwise identical, so «Матанализ 1» and
  // «Матанализ 2» are a run and «Лекция 2» — a title that shares nothing else
  // with its neighbours — is not.
  if ((m = s.match(/(?:^|[^\p{L}\d])([1-9])\s*$/u))) {
    return { kind: 'номер', pos: Number(m[1]) };
  }
  if (/(?:^|[^\p{L}])(?:осень|осенний|fall|autumn)(?![\p{L}])/u.test(s)) {
    return { kind: 'сезон', pos: 1 };
  }
  if (/(?:^|[^\p{L}])(?:весна|весенний|spring)(?![\p{L}])/u.test(s)) {
    return { kind: 'сезон', pos: 2 };
  }
  return null;
}

/**
 * What the parts of one run have in common: the title with its number, year and
 * term taken out.
 *
 * «Лекции» and «Семинары» deliberately survive — a course's lectures and its
 * seminars are two runs, not one run of four, and merging them would number a
 * seminar as part three of the lectures.
 */
export function seriesBase(title: string): string {
  return title
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/част[ья]\s*[№#]?\s*[1-9]|[1-9]\s*-?\s*[ья]?\s*част[ья]|\bч\.\s*[1-9]/g, ' ')
    .replace(/\b(?:part|pt)\.?\s*(?:[1-9]|i{1,3}|iv|vi?)\b/g, ' ')
    .replace(/\[\s*s\s*[1-9]\s*[\]|]/g, ' ')
    .replace(/[1-9]\s*-?\s*(?:й|ый|ой)?\s*семестр|семестр\s*[№#]?\s*[1-9]/g, ' ')
    .replace(/\b(?:сезон|season)\s*[1-9]\b/g, ' ')
    .replace(/\b(?:модул[ья]|блок|раздел|уровень|module|level)\s*[№#]?\s*[1-9]\b/g, ' ')
    .replace(/\b(?:осень|весна|осенний|весенний|fall|spring|autumn)\b/g, ' ')
    .replace(/\b(?:19|20)\d{2}(?:\s*[-/]\s*(?:19|20)?\d{2})?\b/g, ' ')
    .replace(/\b[1-9]\s*к(?:урс)?\b|\bкурс\s*[1-9]\b/g, ' ')
    .replace(/(?:^|[^\p{L}\d])(?:i{1,3}|iv|vi|[1-9])\s*$/u, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** How far apart the years of a group are. Absent years do not count against it. */
function yearSpan(years: Array<number | undefined>): number {
  const known = years.filter((y): y is number => typeof y === 'number');
  return known.length ? Math.max(...known) - Math.min(...known) : 0;
}

/**
 * Marks every playlist that belongs to a run. Playlists that do not are absent
 * from the map, which is the same thing as `series` being undefined on them.
 */
export function detectSeries(playlists: Input[]): Map<string, Series> {
  const groups = new Map<string, Array<Input & { mark: Mark }>>();
  for (const playlist of playlists) {
    const mark = partMark(playlist.title);
    if (!mark) continue;
    const base = seriesBase(playlist.title);
    // Too short a base is not a title, it is whatever was left after the number
    // was removed — «2», «часть». Those would group unrelated playlists.
    if (base.length < 6) continue;
    const key = `${playlist.channelId}|${base}`;
    const list = groups.get(key) ?? [];
    list.push({ ...playlist, mark });
    groups.set(key, list);
  }

  const marks = new Map<string, Series>();
  for (const [key, items] of groups) {
    const positions = new Set(items.map((i) => `${i.mark.kind}${i.mark.pos}`));
    if (positions.size < 2) continue;
    // Autumn beside spring is a run only within one academic year. Further
    // apart it is the same course taught again, which is not a part of anything.
    //
    // A numbered run is allowed to be wider, because it legitimately is: four
    // semesters of analysis take two years to record, and a lecturer who reads
    // the same sequence again adds a second recording of a part rather than a
    // fifth part. Past four years apart even that stops being one run.
    const span = yearSpan(items.map((i) => i.year));
    if (span > (items.some((i) => i.mark.kind === 'сезон') ? 1 : 4)) continue;
    const total = Math.max(...items.map((i) => i.mark.pos));
    for (const item of items) {
      marks.set(item.id, { key, pos: item.mark.pos, total, kind: item.mark.kind });
    }
  }
  return marks;
}
