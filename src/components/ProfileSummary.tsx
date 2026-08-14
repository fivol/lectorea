import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { useActivity, type Week } from '@/lib/activity';
import { useCatalog } from '@/lib/catalog';
import { formatHours, formatMinutes, hoursFromSeconds } from '@/lib/format';
import { useResumePointer, type ResumePointer } from '@/lib/progress';
import { courseHref, useCourseSlice } from '@/lib/url';
import { useProfile } from '@/store/profile';
import { useUi } from '@/store/ui';
import Icon from './Icon';
import { Button } from './ui';

/**
 * The profile, said in one card, on the front page.
 *
 * A catalogue's front page answers "what is there"; somebody who has been here
 * before is asking "where was I", and that answer used to be two presses away
 * behind an avatar in the corner. So the front page carries it: the lecture
 * that was playing, and the three numbers that say whether the habit is alive.
 *
 * The numbers are about the week in hand rather than about everything. A
 * lifetime total is a monument, and a monument says nothing about whether
 * anybody is still studying: «312 лекций просмотрено» reads exactly the same on
 * the morning somebody starts again and on the morning they give up. So hours
 * and lectures are counted from Monday, and the run of days is the one figure
 * here that reaches past the week — it is what the week is being kept for. The
 * totals are still in the panel, which is where somebody goes to look back.
 *
 * Every number is labelled with what it counts. A bare «27» over the word
 * «лекций» is four different facts depending on who is reading it — watched,
 * saved, available, left — and a dashboard nobody can read is decoration.
 *
 * Nothing on it costs a download. The playlist that was open last, the lecture
 * that was playing, and the log of days with what each one was worth are all in
 * the profile already; the one thing it cannot know without the playlist shards
 * is how far through that playlist somebody is, so it does not claim to. That
 * number is in the panel, where the files are worth fetching.
 */

export type Highlights = {
  resume: ResumePointer | null;
  streak: number;
  /** Hours and lectures since Monday. */
  week: Week;
  /** Whether there is anything at all worth showing. */
  any: boolean;
};

export function useHighlights(): Highlights {
  const catalog = useCatalog();
  const profile = useProfile((state) => state.profile);
  const resume = useResumePointer();
  const activity = useActivity();

  /*
   * Whether there is a past here at all — which is a different question from
   * what this week holds. The card shows the week, but a quiet week is not an
   * empty profile, and the card must not disappear every Monday morning from
   * under somebody who has been coming here for a year.
   */
  const studied = useMemo(() => {
    for (const mark of Object.values(profile.videos)) if (mark.done) return true;
    for (const [id, entry] of Object.entries(profile.courses)) {
      if (entry.status === 'done' && catalog.courseById.has(id)) return true;
    }
    return false;
  }, [profile.courses, profile.videos, catalog]);

  return {
    resume,
    streak: activity.streak,
    week: activity.week,
    any: Boolean(resume || activity.total || studied),
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
 * The full statement: over the map it floats as a plate in the corner; over the
 * list it is the first section of the page. Same content either way — only the
 * material under it changes.
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
  const { t, plural } = useT();
  const { resume, week, streak } = highlights;
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
        {/* A ghost is a word rather than a plate, so it carries no layout of its
            own — and a chevron after the word needs one, or it drops to a line
            of its own the moment the row is tight. */}
        <Button
          variant="ghost"
          small
          className="ml-auto inline-flex shrink-0 items-center gap-1 whitespace-nowrap"
          onClick={openProfile}
        >
          {t('ui.nav.profile')}
          <Icon name="chevron-right" size={12} />
        </Button>
      </div>

      <div className={floating ? 'space-y-2.5' : 'flex flex-col gap-3 sm:flex-row sm:items-center'}>
        {resume ? <ResumeButton resume={resume} className={floating ? '' : 'sm:flex-1'} /> : null}

        <div className={`flex items-stretch gap-2 ${floating ? '' : 'shrink-0'}`}>
          {/* Only once there is one. A «0 дней подряд» is a scolding, and the
              first day of a habit is not the moment to deliver one. */}
          {streak ? (
            <Tile
              value={streak}
              label={t('ui.profile.stats.streak', { noun: plural(streak, 'day') })}
            />
          ) : null}
          <WeekTime seconds={week.seconds} />
          <Tile
            value={week.lectures}
            label={t('ui.profile.stats.week', { noun: plural(week.lectures, 'lecture') })}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * The same thing in one row, for a window with no corner to spare.
 *
 * The lecture is the whole of the press: the profile has its own button in the
 * header on every screen, and a bar that is mostly a picture of a lecturer
 * should do the obvious thing when you put a thumb on it. The run of days rides
 * along at the end — one number, the one that is about today — and it is the
 * one part of the bar that opens the panel.
 */
function SummaryBar({ highlights, className }: { highlights: Highlights; className: string }) {
  const { t, count, plural } = useT();
  const catalog = useCatalog();
  const { resume, week, streak } = highlights;
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
          {streak
            ? `${t('ui.home.streak', { n: streak, noun: plural(streak, 'day') })} · `
            : ''}
          {t('ui.profile.stats.week', { noun: count(week.lectures, 'lecture') })}
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
        className="flex min-w-0 flex-1 items-center gap-2 rounded-full py-1 pl-1 pr-2 text-left
                   transition-colors duration-fast ease-out hover:bg-surface-2"
      >
        <Thumbnail videoId={resume.lastVideoId} className="h-8 w-12 shrink-0" iconSize={11} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold text-ink">
            {resume.entry.title}
          </span>
          <span className="block truncate text-[11px] text-ink-faint">
            {course ? t(`course.${course.id}.title`) : t('ui.profile.continue')}
          </span>
        </span>
      </button>
      {streak ? (
        <>
          <span className="plate-divider" aria-hidden="true" />
          <button
            type="button"
            onClick={openProfile}
            aria-label={`${t('ui.profile.stats.streak')}: ${streak}`}
            className="plate-disc num shrink-0 gap-0.5 px-2 text-xs"
          >
            <Icon name="flame" size={12} />
            {streak}
          </button>
        </>
      ) : null}
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
      /*
        `w-full` is not decoration: a button sizes itself to its content even
        when it is a block-level flex container, so without it the row grows to
        the width of the lecture's title and the truncation below never fires —
        which is exactly how the name ran off the edge of the card.
      */
      className={`group flex w-full min-w-0 items-center gap-2.5 rounded-card p-1 text-left
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

/**
 * The week's time, in whatever unit it is actually in.
 *
 * Under an hour the answer is minutes: «0,7 часа» is a number nobody reads as
 * forty minutes, and the first week of a habit is spent entirely below the hour
 * mark — which is exactly the week this card is trying to keep alive.
 */
function WeekTime({ seconds }: { seconds: number }) {
  const { t, plural } = useT();

  if (seconds < 3600) {
    const minutes = formatMinutes(seconds);
    return (
      <Tile
        value={minutes}
        label={t('ui.profile.stats.week', { noun: plural(minutes, 'minute') })}
      />
    );
  }

  const printed = formatHours(hoursFromSeconds(seconds));
  // A fraction takes the genitive singular in Russian — «1,5 часа» — which is
  // the form 2–4 take, so a printed fraction is pluralised as if it were two.
  // Read back off the printed text rather than the number: past ten hours the
  // decimal is dropped, and «12 часа» would be the reward for not looking.
  const shown = Number(printed);
  return (
    <Tile
      value={printed}
      label={t('ui.profile.stats.week', {
        noun: plural(Number.isInteger(shown) ? shown : 2, 'hour'),
      })}
    />
  );
}

function Tile({ value, label }: { value: number | string; label: string }) {
  return (
    <span
      className="flex min-w-[4.25rem] flex-1 flex-col items-center justify-center gap-0.5
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
