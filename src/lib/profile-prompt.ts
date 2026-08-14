import { useMemo } from 'react';
import type { BuiltPlaylist, Profile } from '@shared/schema';
import { useT, type Translator } from '@/i18n';
import { activityOf } from '@/lib/activity';
import { useCatalog } from '@/lib/catalog';
import type { Catalog } from '@/lib/data';
import { formatHours } from '@/lib/format';
import {
  courseProgress,
  percent,
  playlistProgress,
  touchedCourses,
  useCourseShards,
  useWatchedTotals,
  type WatchedTotals,
} from '@/lib/progress';
import { localDay, useProfile } from '@/store/profile';

/**
 * The profile said in words, for a reader that is not this site.
 *
 * The JSON export is for coming back here — ids, timestamps, playback seconds,
 * a visit log. Handed to an assistant instead, nine tenths of it is noise it has
 * to guess its way through: `calculus-1` is not a course name, and where
 * somebody paused a video in March says nothing about what to study next.
 *
 * So this is the same profile with everything that only matters to the site
 * taken out and everything that only matters to a reader put in: titles instead
 * of ids, the field each course belongs to, how far through it somebody is, and
 * which recordings that progress is actually in. It is written in the interface
 * language, because that is the language the answer should come back in.
 */

export type PromptInput = {
  profile: Profile;
  catalog: Catalog;
  t: Translator;
  /** Playlists per course, for the courses whose shards have arrived. */
  shards: Map<string, BuiltPlaylist[]>;
  totals: WatchedTotals;
  /** Where this profile is from — the assistant can go and look. */
  site: string;
  /** Local `YYYY-MM-DD`, for the week's arithmetic. */
  today: string;
};

type Entry = {
  id: string;
  title: string;
  domain: string;
  status: 'done' | 'in_progress' | null;
  favorite: boolean;
};

export function profilePrompt({
  profile,
  catalog,
  t: { t, plural },
  shards,
  totals,
  site,
  today,
}: PromptInput): string {
  /*
   * Courses the profile names, plus courses only its playlists know about.
   *
   * A status is written by hand or by finishing something, and neither has to
   * have happened for a course to be worth mentioning: a playlist half watched
   * is exactly the "what am I in the middle of" the reader is asking about.
   */
  const ids = new Set(Object.keys(profile.courses));
  for (const entry of Object.values(profile.playlists)) {
    if (entry.courseId) ids.add(entry.courseId);
  }

  const entries: Entry[] = [];
  for (const id of ids) {
    const course = catalog.courseById.get(id);
    // A course the catalogue no longer has cannot be named, and an id on its own
    // is exactly the noise this text exists to remove.
    if (!course) continue;
    const mark = profile.courses[id];
    entries.push({
      id,
      title: t(`course.${id}.title`),
      domain: t(`domain.${course.domains[0]}.title`),
      status: mark?.status ?? null,
      favorite: mark?.favorite ?? false,
    });
  }
  entries.sort((a, b) => a.title.localeCompare(b.title));

  /** The recordings a course was actually studied by, and how far each one got. */
  const playlistLines = (courseId: string): string[] => {
    const out: string[] = [];
    for (const playlist of shards.get(courseId) ?? []) {
      const progress = playlistProgress(profile, playlist);
      if (!progress.started) continue;
      out.push(
        progress.complete
          ? t('ui.prompt.playlistDone', {
              title: playlist.title,
              n: progress.total,
              word: plural(progress.total, 'lecture'),
            })
          : t('ui.prompt.playlistPart', {
              title: playlist.title,
              done: progress.done,
              total: progress.total,
              word: plural(progress.total, 'lecture'),
            })
      );
    }
    return out;
  };

  const done: string[] = [];
  const started: string[] = [];
  const favorites: string[] = [];

  for (const entry of entries) {
    const detail = playlistLines(entry.id);
    const plain = t('ui.prompt.course', { title: entry.title, domain: entry.domain });

    if (entry.status === 'done') {
      done.push(plain, ...detail);
      // A favourite that is finished is not something to aim at any more.
      if (entry.favorite) favorites.push(plain);
      continue;
    }

    if (entry.status === 'in_progress' || detail.length) {
      // The share of the recording that is furthest along, measured in time —
      // see `playlistProgress`. Absent while the shard is still on its way,
      // and the line simply says less rather than guessing.
      const progress = courseProgress(profile, shards.get(entry.id) ?? []);
      started.push(
        progress
          ? t('ui.prompt.courseAt', {
              title: entry.title,
              domain: entry.domain,
              percent: percent(progress.fraction),
            })
          : plain,
        ...detail
      );
    }

    if (entry.favorite) favorites.push(plain);
  }

  const section = (heading: string, lines: string[]): string[] =>
    lines.length ? ['', heading, ...lines] : [];

  const activity = activityOf(profile.days, today, 1);
  const goalHours = profile.settings.weekGoal;

  const out = [
    t('ui.prompt.intro', { site }),
    ...section(t('ui.prompt.done', { n: countCourses(done) }), done),
    ...section(t('ui.prompt.progress', { n: countCourses(started) }), started),
    ...section(t('ui.prompt.favorites', { n: favorites.length }), favorites),
    '',
  ];

  if (!done.length && !started.length && !favorites.length) out.push(t('ui.prompt.nothing'));
  if (totals.lectures) {
    out.push(
      t('ui.prompt.watched', {
        hours: formatHours(totals.seconds / 3600),
        lectures: totals.lectures,
      })
    );
  }
  if (activity.total) out.push(t('ui.prompt.days', { n: activity.total }));
  if (activity.week.seconds) {
    const hours = formatHours(activity.week.seconds / 3600);
    out.push(
      goalHours
        ? t('ui.prompt.weekGoal', { hours, goal: formatHours(goalHours) })
        : t('ui.prompt.week', { hours })
    );
  }

  out.push('', t('ui.prompt.ask'));
  return out.join('\n');
}

/** The heading counts courses, and a playlist under one is indented. */
function countCourses(lines: string[]): number {
  return lines.filter((line) => !line.startsWith(' ')).length;
}

/**
 * The prompt for the profile in hand, built on the press.
 *
 * The shards are asked for while the tab is open rather than inside the press:
 * a clipboard write that waits on a download is a clipboard write some browsers
 * refuse, the files are cached for the session anyway, and a prompt built a
 * moment early simply names fewer recordings — the same way every bar on these
 * screens fills in as its shard lands.
 */
export function useProfilePrompt(): () => string {
  const translator = useT();
  const catalog = useCatalog();
  const profile = useProfile((state) => state.profile);
  const totals = useWatchedTotals();
  const shards = useCourseShards(useMemo(() => touchedCourses(profile), [profile]));

  return useMemo(
    () => () =>
      profilePrompt({
        profile,
        catalog,
        t: translator,
        shards,
        totals,
        site: window.location.origin,
        today: localDay(),
      }),
    [profile, catalog, translator, shards, totals]
  );
}
