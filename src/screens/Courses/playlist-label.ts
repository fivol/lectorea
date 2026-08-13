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
 * Rows that still collide after that earn whatever else separates them, and it
 * has to be something the line below is not already saying: that line carries
 * the number of lectures and how long they run, so a name ending in «· 14» or
 * «· пара» is the same fact twice with three millimetres between the two
 * copies. What is left, and what actually differs, is the recording's own
 * title — the part of it the course name is not.
 */
export type LabelParts = { heading: string; detail: string | null };

type Context = {
  providerTitle: (id: string) => string | undefined;
};

/**
 * Drops a leading course name — «Топология — », «Топология: », «Топология, ».
 *
 * The comma is in the list because a good third of these titles are written
 * «Алгоритмы, продвинутый поток» rather than with a dash, and leaving it turns
 * the remainder into «, продвинутый поток».
 */
export function stripCoursePrefix(title: string, courseTitle: string): string {
  const trimmed = title.trim();
  if (!courseTitle || !trimmed.toLowerCase().startsWith(courseTitle.toLowerCase())) return trimmed;
  const rest = trimmed.slice(courseTitle.length).replace(/^\s*[—–\-:.,;·|]\s*/, '');
  // A title that is *only* the course name has nothing else to offer.
  return rest || trimmed;
}

/** How much of a title is still worth reading as the tail of a name. */
const TITLE_TAIL_MAX = 40;

/**
 * The part of a recording's title that is its own.
 *
 * The course name comes off the front and a trailing parenthetical comes off
 * the back: «Алгоритмы, продвинутый поток (1 курс, 2020)» is telling us the
 * year for the third time, and the heading already has it. What is left —
 * «продвинутый поток» — is the thing a person would actually say to tell this
 * recording from the one next to it.
 */
function ownTitle(title: string, courseTitle: string): string {
  return stripCoursePrefix(title, courseTitle)
    .replace(/\s*\([^()]*\)\s*$/, '')
    .trim();
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
        heading: twins ? `${dated} · ${discriminator(playlist, group, courseTitle)}` : dated,
        // The tooltip keeps the whole of it, parenthetical and all: that is
        // where somebody goes to find out exactly which recording this is.
        detail: stripCoursePrefix(playlist.title, courseTitle),
      });
    }
  }
  return out;
}

/**
 * What tells this playlist apart from its twins.
 *
 * The year is not a candidate: it is already in the name by the time this is
 * reached, and this is only reached when it failed to separate anything. Nor is
 * the lecture count or the lecture length, which the line under the name is
 * already showing.
 *
 * So it is the recording's own title, with the course name taken off the front
 * — «Дерево Фенвика» out of «Алгоритмы — Дерево Фенвика». Two recordings that
 * share a faculty, a year *and* a title are indistinguishable in the data as
 * well as on the screen, and then the count is all that is left to say.
 */
function discriminator(
  playlist: BuiltPlaylist,
  group: BuiltPlaylist[],
  courseTitle: string
): string {
  const own = ownTitle(playlist.title, courseTitle);
  const alone = group.filter((other) => ownTitle(other.title, courseTitle) === own).length === 1;
  // Past a certain length a title has stopped being a name and become a
  // sentence, and a name that runs off the end of the row separates nothing.
  if (alone && own && own.length <= TITLE_TAIL_MAX) return own;
  return `${playlist.videoCount}`;
}
