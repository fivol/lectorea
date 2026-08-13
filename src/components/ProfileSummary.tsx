import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { useNearestGoal, type Goal, type GoalProgress } from '@/lib/goals';
import { percent, useResumePointer, type ResumePointer } from '@/lib/progress';
import { courseHref, useCourseSlice } from '@/lib/url';
import { useProfile } from '@/store/profile';
import { useUi } from '@/store/ui';
import Icon from './Icon';
import ProgressBar from './ProgressBar';
import { Button } from './ui';

/**
 * The profile, said in one card, on the front page.
 *
 * A catalogue's front page answers "what is there"; somebody who has been here
 * before is asking "where was I". That answer used to be two presses away
 * behind an avatar in the corner, which is a fine place for settings and a poor
 * one for the single thing a returning reader wants. So the corner button grows
 * into what it was standing for: the lecture that was playing, how much is
 * behind you, and how far the nearest goal is.
 *
 * Nothing here costs a download. Everything on this card is already in the
 * profile or in the catalogue the page has loaded anyway — the playlist that
 * was open last, the lecture that was playing, the ticks, and the paths between
 * courses. The one thing the profile cannot know without the shards is how far
 * through that playlist somebody is, so the card does not claim to: it says
 * what you were watching and leaves the percentage to the panel, where the
 * files are worth fetching.
 */

export type Highlights = {
  resume: ResumePointer | null;
  nearest: (Goal & GoalProgress) | null;
  lectures: number;
  coursesDone: number;
  /** Whether there is anything at all worth showing. */
  any: boolean;
};

export function useHighlights(): Highlights {
  const catalog = useCatalog();
  const profile = useProfile((state) => state.profile);
  const resume = useResumePointer();
  const nearest = useNearestGoal();

  const counts = useMemo(() => {
    let coursesDone = 0;
    for (const [id, entry] of Object.entries(profile.courses)) {
      if (entry.status === 'done' && catalog.courseById.has(id)) coursesDone += 1;
    }
    let lectures = 0;
    for (const mark of Object.values(profile.videos)) if (mark.done) lectures += 1;
    return { coursesDone, lectures };
  }, [profile.courses, profile.videos, catalog]);

  return {
    resume,
    nearest,
    ...counts,
    any: Boolean(resume || nearest || counts.coursesDone || counts.lectures),
  };
}

type Variant = 'card' | 'section' | 'bar';

export default function ProfileSummary({
  variant,
  className = '',
}: {
  variant: Variant;
  className?: string;
}) {
  const highlights = useHighlights();
  if (!highlights.any) return null;
  if (variant === 'bar') return <SummaryBar highlights={highlights} className={className} />;
  return <SummaryCard highlights={highlights} variant={variant} className={className} />;
}

/**
 * The full statement: over the map it floats as a plate in the corner the
 * profile button used to be in; over the list it is the first section of the
 * page. Same content either way — only the material under it changes.
 */
function SummaryCard({
  highlights,
  variant,
  className,
}: {
  highlights: Highlights;
  variant: Variant;
  className: string;
}) {
  const { t } = useT();
  const { resume, nearest, lectures, coursesDone } = highlights;
  const openProfile = useUi((state) => state.openProfile);
  const floating = variant === 'card';

  return (
    <div
      className={`${floating ? 'plate w-[19.5rem] rounded-card p-3' : 'surface p-3 sm:p-4'}
                  ${className}`}
    >
      <div className="mb-2.5 flex items-center gap-2">
        <span className="profile-disc shrink-0">
          <Icon name="profile" size={14} />
        </span>
        <span className="mono-label truncate text-ink-dim">{t('ui.home.title')}</span>
        <Button variant="ghost" small className="ml-auto shrink-0" onClick={openProfile}>
          {t('ui.nav.profile')}
          <Icon name="chevron-right" size={12} />
        </Button>
      </div>

      <div className={floating ? 'space-y-2.5' : 'flex flex-col gap-3 sm:flex-row sm:items-center'}>
        {resume ? <ResumeButton resume={resume} className={floating ? '' : 'sm:flex-1'} /> : null}

        <div className={`flex items-stretch gap-2 ${floating ? '' : 'shrink-0'}`}>
          <Tile value={lectures} label={t('ui.profile.stats.lectures')} />
          <Tile value={coursesDone} label={t('ui.profile.stats.courses')} />
        </div>
      </div>

      {nearest ? <GoalRow goal={nearest} className="mt-2.5" /> : null}
    </div>
  );
}

/** The same thing in one row, for a window with no corner to spare. */
function SummaryBar({ highlights, className }: { highlights: Highlights; className: string }) {
  const { t, count } = useT();
  const catalog = useCatalog();
  const { resume, nearest, lectures } = highlights;
  const openProfile = useUi((state) => state.openProfile);
  const openResume = useOpenResume();

  if (!resume) {
    return (
      <button
        type="button"
        onClick={openProfile}
        className={`plate tap-soft flex max-w-[92vw] items-center gap-2 py-1.5 pl-1.5 pr-3
                    text-xs text-ink-dim transition-colors duration-fast ease-out
                    hover:text-ink ${className}`}
      >
        <span className="profile-disc shrink-0">
          <Icon name="profile" size={13} />
        </span>
        <span className="num truncate">
          {count(lectures, 'lecture')}
          {nearest ? ` · ${t('ui.home.toGoal', { n: percent(nearest.progress.fraction) })}` : ''}
        </span>
        <Icon name="chevron-right" size={12} className="shrink-0" />
      </button>
    );
  }

  const course = catalog.courseById.get(resume.entry.courseId);

  return (
    <div className={`plate flex max-w-[92vw] items-center gap-1 p-1 ${className}`}>
      <button
        type="button"
        onClick={() => openResume(resume)}
        className="flex min-w-0 items-center gap-2 rounded-full py-1 pl-1 pr-2 text-left
                   transition-colors duration-fast ease-out hover:bg-surface-2"
      >
        <Thumbnail videoId={resume.lastVideoId} className="h-8 w-12 shrink-0" iconSize={11} />
        <span className="min-w-0">
          <span className="block truncate text-xs font-semibold text-ink">
            {resume.entry.title}
          </span>
          <span className="block truncate text-[11px] text-ink-faint">
            {course ? t(`course.${course.id}.title`) : t('ui.profile.continue')}
          </span>
        </span>
      </button>
      <span className="plate-divider" aria-hidden="true" />
      <button
        type="button"
        onClick={openProfile}
        aria-label={t('ui.nav.profile')}
        className="plate-disc shrink-0"
      >
        <Icon name="profile" size={14} />
      </button>
    </div>
  );
}

/** Where you stopped, one press from the front page. */
function ResumeButton({ resume, className = '' }: { resume: ResumePointer; className?: string }) {
  const { t } = useT();
  const catalog = useCatalog();
  const openResume = useOpenResume();
  const course = catalog.courseById.get(resume.entry.courseId);

  return (
    <button
      type="button"
      onClick={() => openResume(resume)}
      className={`group flex min-w-0 items-center gap-2.5 rounded-card p-1 text-left
                  transition-colors duration-fast ease-out hover:bg-surface-2 ${className}`}
    >
      <Thumbnail videoId={resume.lastVideoId} className="h-11 w-[4.5rem] shrink-0" iconSize={13} />
      <span className="min-w-0 flex-1">
        <span className="mono-label block text-accent">{t('ui.profile.continue')}</span>
        <span className="mt-0.5 block truncate text-sm font-semibold text-ink">
          {resume.entry.title}
        </span>
        <span className="block truncate text-[11px] text-ink-faint">
          {course ? t(`course.${course.id}.title`) : resume.entry.courseId}
        </span>
      </span>
    </button>
  );
}

function GoalRow({ goal, className = '' }: { goal: Goal & GoalProgress; className?: string }) {
  const { t } = useT();
  const navigate = useNavigate();
  const sliceAround = useCourseSlice();

  return (
    <button
      type="button"
      onClick={() => navigate(courseHref(goal.course.id, sliceAround(goal.course.id)))}
      className="block w-full rounded-card p-1 text-left transition-colors duration-fast ease-out
                 hover:bg-surface-2"
    >
      <span className={`flex items-baseline gap-2 ${className}`}>
        <span className="mono-label shrink-0 text-ink-faint">{t('ui.home.goal')}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-ink">
          {t(`course.${goal.course.id}.title`)}
        </span>
      </span>
      {/* Whole courses only. The part-finished one in hand is drawn in the
          panel, where the playlists it is measured in have been fetched. */}
      <ProgressBar
        className="mt-1.5"
        done={goal.progress.done}
        total={goal.progress.total}
        label={t('ui.profile.progress', {
          done: goal.progress.done,
          total: goal.progress.total,
        })}
      />
    </button>
  );
}

function Thumbnail({
  videoId,
  className,
  iconSize,
}: {
  videoId?: string;
  className: string;
  iconSize: number;
}) {
  return (
    <span className={`relative overflow-hidden rounded bg-surface-2 ${className}`}>
      {videoId ? (
        <img
          src={`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
        />
      ) : null}
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-canvas/70 text-ink">
          <Icon name="play" size={iconSize} />
        </span>
      </span>
    </span>
  );
}

function Tile({ value, label }: { value: number; label: string }) {
  return (
    <span
      className="flex min-w-[3.75rem] flex-1 flex-col items-center justify-center gap-0.5
                 rounded-card border border-line px-2 py-1.5 text-center"
    >
      <span className="num text-h3 leading-none text-ink">{value}</span>
      <span className="text-[10px] leading-tight text-ink-faint">{label}</span>
    </span>
  );
}

/** Back into the playlist that was open, with its own field behind it. */
function useOpenResume(): (resume: ResumePointer) => void {
  const navigate = useNavigate();
  const sliceAround = useCourseSlice();

  return (resume) => {
    const query = new URLSearchParams(sliceAround(resume.entry.courseId));
    query.set('playlist', resume.entry.id);
    navigate(courseHref(resume.entry.courseId, `?${query.toString()}`));
  };
}
