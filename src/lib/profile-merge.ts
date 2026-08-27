import { DAYS_LIMIT, RECENT_LIMIT, type Profile } from '@shared/schema';

/**
 * Two profiles into one, losing nothing either of them knows.
 *
 * The one operation the whole of syncing rests on, which is why it is a pure
 * function of two profiles rather than a method on the store: the file import
 * calls it, the sync calls it, and a test can call it with two literals. It is
 * commutative and idempotent — merging in either order gives the same profile,
 * and merging twice changes nothing — and that is not a nicety. It is what
 * makes it safe to run on a device that cannot know whether it has already run.
 *
 * The bias is union, everywhere: a lecture watched on either machine is
 * watched, a day studied on either is studied. The cost of that bias is stated
 * plainly because it is real — **a merge cannot carry an erasure**. Untick a
 * lecture on the phone, merge with a laptop that still has the tick, and the
 * tick comes back. That is why the sync only merges where two histories
 * genuinely diverged, and otherwise moves one side forward wholesale
 * (`decideSync` in `lib/sync.ts`).
 *
 * `settings` are deliberately untouched: they belong to whoever is applying the
 * merge, and the sync decides separately whose are newer.
 */
const STATUS_RANK: Record<string, number> = { done: 2, in_progress: 1, null: 0 };

export function mergeProfiles(base: Profile, incoming: Profile): Profile {
  const courses = { ...base.courses };
  for (const [id, entry] of Object.entries(incoming.courses)) {
    const existing = courses[id];
    if (!existing) {
      courses[id] = entry;
      continue;
    }
    const incomingWins =
      (STATUS_RANK[String(entry.status)] ?? 0) > (STATUS_RANK[String(existing.status)] ?? 0);
    courses[id] = {
      status: incomingWins ? entry.status : existing.status,
      favorite: existing.favorite || entry.favorite,
      // The claim travels with the status it was made about: a course finished
      // by hand on one machine must not be walked back by the automation on
      // the other.
      manual: incomingWins ? entry.manual : existing.manual,
      at: entry.at > existing.at ? entry.at : existing.at,
    };
  }

  const playlists = { ...base.playlists };
  for (const [id, entry] of Object.entries(incoming.playlists)) {
    const existing = playlists[id];
    playlists[id] = existing
      ? {
          watched: existing.watched || entry.watched,
          favorite: existing.favorite || entry.favorite,
          lastVideoId:
            entry.at > existing.at
              ? (entry.lastVideoId ?? existing.lastVideoId)
              : (existing.lastVideoId ?? entry.lastVideoId),
          courseId: existing.courseId ?? entry.courseId,
          at: entry.at > existing.at ? entry.at : existing.at,
        }
      : entry;
  }

  // A lecture watched on either machine is watched; short of that, the
  // further-along position is the useful one to come back to.
  const videos = { ...base.videos };
  for (const [id, entry] of Object.entries(incoming.videos)) {
    const existing = videos[id];
    if (!existing) {
      videos[id] = entry;
      continue;
    }
    videos[id] =
      existing.done || entry.done
        ? { done: true }
        : { done: false, sec: Math.max(existing.sec ?? 0, entry.sec ?? 0) };
  }

  // History interleaves by time and keeps the later visit of a repeat.
  const byId = new Map(base.recent.map((item) => [item.id, item]));
  for (const item of incoming.recent) {
    const existing = byId.get(item.id);
    if (!existing || item.at > existing.at) byId.set(item.id, item);
  }
  const recent = [...byId.values()]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, RECENT_LIMIT);

  /*
   * A day studied on either machine is a day studied — the union, which is the
   * only merge that cannot break a streak somebody really kept.
   *
   * What a shared day was worth is the larger of the two rather than the sum:
   * the usual reason for a merge is the same profile arriving back from another
   * browser, and adding those together would double every hour on it. Two
   * machines genuinely used on one day lose the smaller half, which is the
   * cheaper of the two mistakes.
   */
  const byDay = new Map(base.days.map((entry) => [entry.day, entry]));
  for (const entry of incoming.days) {
    const existing = byDay.get(entry.day);
    byDay.set(entry.day, {
      day: entry.day,
      sec: Math.max(existing?.sec ?? 0, entry.sec),
      lectures: Math.max(existing?.lectures ?? 0, entry.lectures),
    });
  }
  const days = [...byDay.values()]
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(-DAYS_LIMIT);

  return { ...base, courses, playlists, videos, recent, days };
}
