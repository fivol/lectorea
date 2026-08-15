import type { BuiltPlaylist, Series } from '@shared/schema';
import type { Translator } from '@/i18n';

/**
 * One entry of the list: a recording on its own, or a run of them that is one
 * course cut into parts.
 */
export type ListItem =
  | { kind: 'one'; playlist: BuiltPlaylist }
  | { kind: 'run'; key: string; parts: BuiltPlaylist[] };

/**
 * Puts the parts of a run next to each other, and leaves everything else where
 * the sort put it.
 *
 * The run takes the place of its best-placed part, so ordering by rating still
 * decides where in the list it appears — what changes is that «Часть 2» is no
 * longer eleven rows below «Часть 1» with unrelated recordings in between,
 * which is a list telling you the second half is a worse choice than the first.
 *
 * `rows` decide what is shown and in what order; `all` decides what a run is
 * made of. A course is never cut to fit a filter: one part matching brings the
 * whole run with it. A run drawn with parts missing out of the middle of it is
 * a list quietly renumbering somebody's course — «Часть 1, Часть 3» under one
 * heading reads as a course whose second part does not exist, when all that
 * happened is that it was filmed in a year the year filter excludes.
 */
export function groupRuns(rows: BuiltPlaylist[], all: BuiltPlaylist[] = rows): ListItem[] {
  const byKey = new Map<string, BuiltPlaylist[]>();
  for (const playlist of all) {
    if (!playlist.series) continue;
    const list = byKey.get(playlist.series.key) ?? [];
    list.push(playlist);
    byKey.set(playlist.series.key, list);
  }

  const done = new Set<string>();
  const items: ListItem[] = [];
  for (const playlist of rows) {
    const key = playlist.series?.key;
    const parts = key ? byKey.get(key) : undefined;
    if (!key || !parts || parts.length < 2) {
      items.push({ kind: 'one', playlist });
      continue;
    }
    if (done.has(key)) continue;
    done.add(key);
    items.push({
      kind: 'run',
      key,
      parts: [...parts].sort((a, b) => (a.series?.pos ?? 0) - (b.series?.pos ?? 0)),
    });
  }
  return items;
}

/**
 * What a university called this part. The word is theirs — «часть» where they
 * wrote «часть», «семестр» where the number was a semester — because a reader
 * matching our list against their timetable is matching the word too.
 */
export function partLabel(series: Series, t: Translator['t']): string {
  const key =
    series.kind === 'семестр'
      ? 'semester'
      : series.kind === 'сезон'
        ? 'season'
        : series.kind === 'модуль'
          ? 'module'
          : 'part';
  return t(`ui.playlist.part.${key}`, { n: series.pos });
}

/**
 * Whether the row's own name already says which part this is.
 *
 * «Часть 1 · Алгебра. Часть 1. Семинары» says it twice, and the second time is
 * the recording's real title — which is the one that has to stay. So the label
 * asks first and stays quiet when the title has it covered.
 */
export function saysItsPart(series: Series, text: string): boolean {
  const n = series.pos;
  return new RegExp(
    `(?:част[ья]|part|pt\\.?|модул[ья]|раздел|сезон|season|module)\\s*[№#]?\\s*${n}(?![\\d])` +
      // `[s1]` as ИТМО writes it, and the bare `s1` the heading is left with once
      // the brackets are stripped off it.
      `|(?:^|[^\\p{L}\\d])s\\s*${n}(?![\\d])` +
      `|${n}\\s*-?\\s*(?:й|ый|ой)?\\s*семестр`,
    'iu'
  ).test(text);
}

/** The parts of the run either side of this one, for the player's own links. */
export function neighbours(
  playlist: BuiltPlaylist,
  siblings: BuiltPlaylist[]
): { prev: BuiltPlaylist | null; next: BuiltPlaylist | null } {
  const index = siblings.findIndex((item) => item.id === playlist.id);
  if (index < 0) return { prev: null, next: null };
  return {
    prev: siblings[index - 1] ?? null,
    next: siblings[index + 1] ?? null,
  };
}
