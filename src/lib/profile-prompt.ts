import { useMemo } from 'react';
import type { Profile } from '@shared/schema';
import { useT, type Translator } from '@/i18n';
import { activityOf } from '@/lib/activity';
import { useCatalog } from '@/lib/catalog';
import type { Catalog } from '@/lib/data';
import { formatHours } from '@/lib/format';
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
 * of ids, the field and the level of each course, and the question at the end.
 * It is written in the interface language, because that is the language the
 * answer should come back in.
 */

export type PromptInput = {
  profile: Profile;
  catalog: Catalog;
  t: Translator['t'];
  /** Where this profile is from — the assistant can go and look. */
  site: string;
  /** Local `YYYY-MM-DD`, for the week's arithmetic. */
  today: string;
};

type Line = { level: number; text: string };

export function profilePrompt({ profile, catalog, t, site, today }: PromptInput): string {
  const done: Line[] = [];
  const started: Line[] = [];
  const goals: Line[] = [];

  for (const [id, entry] of Object.entries(profile.courses)) {
    const course = catalog.courseById.get(id);
    // A course the catalogue no longer has cannot be named, and an id on its own
    // is exactly the noise this text exists to remove.
    if (!course) continue;

    const domain = course.domains[0];
    const line: Line = {
      level: course.level,
      text: t('ui.prompt.course', {
        title: t(`course.${id}.title`),
        domain: t(`domain.${domain}.title`),
        level: course.level,
      }),
    };

    if (entry.status === 'done') done.push(line);
    else if (entry.status === 'in_progress') started.push(line);
    // A favourite that is finished is not a goal any more — it is the line above.
    if (entry.favorite && entry.status !== 'done') goals.push(line);
  }

  const byLevel = (a: Line, b: Line): number =>
    a.level - b.level || a.text.localeCompare(b.text);
  // The heading is translated by the caller rather than looked up from a key
  // passed in: `check:i18n` reads literals out of the source, and a key that
  // only ever exists in a variable is a key it cannot see being used.
  const section = (heading: string, lines: Line[]): string[] =>
    lines.length ? ['', heading, ...lines.sort(byLevel).map((line) => line.text)] : [];

  const lectures = Object.values(profile.videos).filter((mark) => mark.done).length;
  const sealed = Object.values(profile.playlists).filter((mark) => mark.watched).length;
  const activity = activityOf(profile.days, today, 1);
  const goalHours = profile.settings.weekGoal;

  const out = [
    t('ui.prompt.intro', { site }),
    ...section(t('ui.prompt.done', { n: done.length }), done),
    ...section(t('ui.prompt.progress', { n: started.length }), started),
    ...section(t('ui.prompt.goals', { n: goals.length }), goals),
    '',
  ];

  if (!done.length && !started.length && !goals.length) out.push(t('ui.prompt.nothing'));
  if (lectures) out.push(t('ui.prompt.lectures', { n: lectures }));
  if (sealed) out.push(t('ui.prompt.playlists', { n: sealed }));
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

/** The prompt for the profile in hand, built only when something asks for it. */
export function useProfilePrompt(): () => string {
  const { t } = useT();
  const catalog = useCatalog();
  const profile = useProfile((state) => state.profile);

  return useMemo(
    () => () =>
      profilePrompt({
        profile,
        catalog,
        t,
        site: window.location.origin,
        today: localDay(),
      }),
    [profile, catalog, t]
  );
}
