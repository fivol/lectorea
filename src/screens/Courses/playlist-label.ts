import type { BuiltPlaylist } from '@shared/schema';

/**
 * What to call a playlist inside the panel of the course it belongs to.
 *
 * The canonical title starts with the course name — «Топология — Лекции МФТИ ·
 * курс лекций» — which is right in a search result and useless in a list of
 * five playlists for топология, where it makes every row open with the same
 * word and pushes the part that differs off the end. The course is named by the
 * heading above the list, so here the row leads with the source instead.
 *
 * The year comes next, on every row that has one. It used to be added only to
 * rows that collided — an unadorned «Лекториум» being clearer than «Лекториум ·
 * 2016» when there is only one of them — but the year was then printed a second
 * time in the line below, for every row, which is the same fact twice and the
 * worse of the two placements. One place, and the heading is it.
 *
 * Rows that still collide after that earn whatever else separates them: the
 * lecture length, failing that the number of lectures.
 */
export type LabelParts = { heading: string; detail: string | null };

type Context = {
  providerTitle: (id: string) => string | undefined;
  lengthLabel: (playlist: BuiltPlaylist) => string;
};

/** Drops a leading course name — «Топология — », «Топология: », «Топология. ». */
export function stripCoursePrefix(title: string, courseTitle: string): string {
  const trimmed = title.trim();
  if (!courseTitle || !trimmed.toLowerCase().startsWith(courseTitle.toLowerCase())) return trimmed;
  const rest = trimmed.slice(courseTitle.length).replace(/^\s*[—–\-:.·|]\s*/, '');
  // A title that is *only* the course name has nothing else to offer.
  return rest || trimmed;
}

export function playlistHeadings(
  playlists: BuiltPlaylist[],
  courseTitle: string,
  context: Context
): Map<string, LabelParts> {
  const base = new Map<string, string>();
  for (const playlist of playlists) {
    const source = context.providerTitle(playlist.providerId) ?? playlist.channelTitle;
    base.set(playlist.id, playlist.lecturer ? `${source} · ${playlist.lecturer}` : source);
  }

  const byBase = new Map<string, BuiltPlaylist[]>();
  for (const playlist of playlists) {
    const key = base.get(playlist.id)!;
    byBase.set(key, [...(byBase.get(key) ?? []), playlist]);
  }

  const out = new Map<string, LabelParts>();
  for (const [key, group] of byBase) {
    for (const playlist of group) {
      const dated = playlist.year ? `${key} · ${playlist.year}` : key;
      // Two recordings by the same faculty in the same year — or two with no
      // year at all — are still indistinguishable, and only those pay for a
      // third part to the name.
      const twins = group.filter((other) => other.year === playlist.year).length > 1;
      out.set(playlist.id, {
        heading: twins ? `${dated} · ${discriminator(playlist, group, context)}` : dated,
        detail: stripCoursePrefix(playlist.title, courseTitle),
      });
    }
  }
  return out;
}

/**
 * The first field that tells this playlist apart from its twins.
 *
 * The year is not among them: it is already in the name by the time this is
 * reached, and this is only reached when it failed to separate anything.
 */
function discriminator(
  playlist: BuiltPlaylist,
  group: BuiltPlaylist[],
  context: Context
): string {
  const unique = <T>(pick: (p: BuiltPlaylist) => T): boolean =>
    group.filter((other) => pick(other) === pick(playlist)).length === 1;

  if (unique((p) => p.lectureLength)) return context.lengthLabel(playlist);
  return `${playlist.videoCount}`;
}
