import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { useActivity, useDayGoal, useWeekGoal, type DayGoal, type Week } from '@/lib/activity';
import { useCatalog } from '@/lib/catalog';
import { useResumeList, type ResumePointer } from '@/lib/progress';
import { useProfile } from '@/store/profile';
import { useUi } from '@/store/ui';
import { LEARN_PATH } from '@/lib/entry';
import Icon from './Icon';
import { CountTile } from './Facts';
import TodayLine from './game/TodayLine';
import { ContinueOffer, useOpenResume } from './ContinueBlock';
import { LectureThumb, ResumeStepper, useResumeCarousel } from './ResumeCard';
import { WeekGoalBar } from './WeekGoal';
import { Button, IconButton } from './ui';

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
 * Almost nothing on it costs a download. The playlist that was open last, the
 * lecture that was playing, and the log of days with what each one was worth are
 * all in the profile already. The one exception is the bar under the offer — how
 * far through that recording somebody is lives in the shard and nowhere else —
 * and it is one file, for the course the press is about to open anyway, fetched
 * after the card is on screen. So the card is complete without it and better
 * with it; see `useResumeProgress`.
 */

export type Highlights = {
  resume: ResumePointer | null;
  /** Everything there is to go back to, newest first — what the arrow leafs through. */
  resumes: ResumePointer[];
  streak: number;
  /** Hours and lectures since Monday. */
  week: Week;
  /** Whether there is anything at all worth showing. */
  any: boolean;
};

export function useHighlights(): Highlights {
  const catalog = useCatalog();
  const profile = useProfile((state) => state.profile);
  const resumes = useResumeList();
  const resume = resumes[0] ?? null;
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
    resumes,
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
  const hidden = useUi((state) => state.summaryHidden);
  if (!highlights.any || hidden) return null;
  if (variant === 'bar') return <SummaryBar highlights={highlights} className={className} />;
  return <SummaryCard highlights={highlights} variant={variant} className={className} />;
}

/**
 * The full statement: over the map it floats as a plate in the corner; over the
 * list it is the first section of the page. Same content either way — only the
 * material under it changes.
 *
 * Neither flavour carries a width: a card is as wide as the place it is put,
 * and the corner over the map is measured against the chrome above it rather
 * than set here — see `--rail` in `MapScreen`.
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
  const { resumes, week, streak } = highlights;
  const hideSummary = useUi((state) => state.hideSummary);
  const floating = variant === 'card';
  const { current: resume, index, count, prev, next } = useResumeCarousel(resumes);
  const goal = useWeekGoal();

  return (
    <div
      className={`${floating ? 'plate w-full rounded-card p-3' : 'surface p-3 sm:p-4'}
                  ${className}`}
    >
      <div className="mb-2.5 flex items-center gap-2">
        <span className="profile-disc shrink-0">
          <Icon name="profile" size={14} />
        </span>
        {/* The title takes the slack, so the controls after it sit at the right
            edge whether or not the stepper is there to be one of them. */}
        <span className="mono-label min-w-0 flex-1 truncate text-ink-dim">{t('ui.home.title')}</span>
        <ResumeStepper index={index} count={count} onPrev={prev} onNext={next} />
        {/* A × rather than a second «Профиль».
            The word was here and in the header at the same time, a thumb apart,
            and the door to the panel has always been the one in the corner —
            the card is a shortcut into it, not a second entrance that needs
            announcing. What the corner of a card is actually good for is
            getting rid of the card: this is somebody's own study looking back
            at them, and there are days for that and days not. It comes back on
            the next load, so nothing is lost by pressing it. */}
        <IconButton
          icon="close"
          iconSize={14}
          label={t('ui.home.hide')}
          className="shrink-0"
          onClick={hideSummary}
        />
      </div>

      <div className={floating ? 'space-y-2.5' : 'flex flex-col gap-3 sm:flex-row sm:items-center'}>
        {/*
          The offer and the day it belongs to, in one block, because they are
          one decision. Everything else on this card is a report of what has
          already happened; the day is the only thing on it that asks for
          something, and the press that answers it is directly above — «ещё 20
          минут» a line away from the lecture those twenty minutes are in. The
          same line stands in the player, where the question is "one more
          lecture" rather than "anything at all tonight". [game:today]
        */}
        <div className={`min-w-0 space-y-1 ${floating ? '' : 'sm:flex-1'}`}>
          {resume ? <ContinueOffer resume={resume} /> : null}
          {/* Indented to the offer's own padding, so the sentence starts under
              the word «Продолжить» rather than under the still beside it. */}
          <TodayLine className="px-1" />
        </div>

        <div className={`flex flex-col gap-2 ${floating ? '' : 'shrink-0'}`}>
          <div className="flex items-stretch gap-2">
            {/* Only once there is one. A «0 дней подряд» is a scolding, and the
                first day of a habit is not the moment to deliver one. */}
            {streak ? (
              <CountTile
                value={streak}
                label={t('ui.profile.stats.streak', { noun: plural(streak, 'day') })}
              />
            ) : null}
            {/* And only while the bar below is not already saying it. «1,8 из
                4,5 ч» contains this tile whole — the tile adds the word «часа»
                and takes a third of the row to do it. Without a goal there is
                no bar and the tile is the only place the week's hours appear,
                which is why it stays rather than moving. The line it frees is
                what the day above is standing on: the card carries three
                horizons and did not grow. */}
            {goal ? null : <WeekTime seconds={week.seconds} />}
            <CountTile
              value={week.lectures}
              label={t('ui.profile.stats.week', { noun: plural(week.lectures, 'lecture') })}
            />
          </div>
          {/* Nothing at all until a goal is set — see `WeekGoal`. The bar is
              the whole of it here: the choosing lives in the panel, and a card
              in the corner of a map is not where somebody decides how much
              they mean to study this week. One slot, and with no goal in it the
              invitation below stands in the same place. */}
          <WeekGoalBar />
          <GoalInvite />
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
  const { t, count, plural, span } = useT();
  const catalog = useCatalog();
  const { resume, week, streak } = highlights;
  // Both presses that are not the lecture lead to the desk rather than to the
  // settings drawer: a run of days is a report, and the report is a place now.
  const toDesk = useDesk();
  const openResume = useOpenResume();
  const day = useDayGoal();

  if (!resume) {
    return (
      <button
        type="button"
        onClick={toDesk}
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
        className="inlay-hover group flex min-w-0 flex-1 items-center gap-2 rounded-full py-1 pl-1
                   pr-2 text-left"
      >
        <LectureThumb videoId={resume.lastVideoId} className="h-8 w-12 shrink-0" iconSize={11} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold text-ink">
            {resume.entry.title}
          </span>
          <span className="block truncate text-[11px] text-ink-faint">
            {course ? t(`course.${course.id}.title`) : t('ui.profile.continue')}
          </span>
        </span>
      </button>
      {streak || day ? (
        <>
          <span className="plate-divider" aria-hidden="true" />
          <button
            type="button"
            onClick={toDesk}
            // The whole sentence, not the caption: the tile's «{noun} подряд»
            // is written to stand under a number, and read out on its own it
            // was announcing the word «{noun}». The day joins it in words,
            // because a ring is a shape and a shape reads out as nothing.
            aria-label={[
              streak ? t('ui.home.streak', { n: streak, noun: plural(streak, 'day') }) : null,
              day
                ? t('ui.game.todayOf', {
                    done: span(day.done).value,
                    target: span(day.seconds).text,
                  })
                : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            className="plate-disc num shrink-0 gap-0.5 px-2 text-xs"
          >
            {/* The day takes the glyph's place rather than a place of its own.
                There is one disc at the end of this bar and it is already the
                thing about today — a run of days is kept by closing today —
                so the ring goes round nothing and replaces the flame, and the
                bar is exactly as wide as it was. Without a goal there is no
                ring and the flame stays. */}
            {day ? <DayRing goal={day} /> : <Icon name="flame" size={12} />}
            {streak || null}
          </button>
        </>
      ) : null}
    </div>
  );
}

/**
 * «Поставить цель» — offered only to somebody who already has the habit it
 * would describe.
 *
 * A goal is the one thing on these screens that is chosen rather than earned,
 * and the standing rule is that nobody is handed one they did not ask for: a
 * target set for a reader who came here to watch one lecture is a debt, and a
 * debt is what makes people stop opening a panel. That argument is about
 * *strangers*, though, and it has been quietly keeping the offer from the
 * readers it is for — the goal lives three presses away behind an avatar, and
 * a reader who has studied on eight evenings out of the last twenty-eight has
 * shown what their week looks like without ever being asked to name it.
 *
 * So the invitation waits for the habit and then stands in the goal's own slot
 * on the card. Three days is the same floor `useWeekPace` uses before it will
 * average anything: under it there is no habit to describe, only a visit or
 * two. It is one line, it opens the panel where the choosing belongs, and the
 * card's × puts it away with everything else for the visit.
 */
const GOAL_INVITE_MIN_DAYS = 3;

function GoalInvite() {
  const { t } = useT();
  const goal = useWeekGoal();
  const activity = useActivity();
  const toDesk = useDesk();

  const studied = activity.recent.filter((day) => day.studied).length;
  if (goal || studied < GOAL_INVITE_MIN_DAYS) return null;

  return (
    /* A ghost is a word rather than a plate and carries no layout of its own,
       so the mark in front of it needs one — the same shape the panel's own
       «Поставить цель» has, since it is the same decision reached from a
       different room. */
    <Button
      variant="ghost"
      small
      icon="target"
      className="inline-flex items-center gap-1.5"
      onClick={toDesk}
    >
      {t('ui.profile.goal.set')}
    </Button>
  );
}

/** The week's time, in whatever unit it is actually in — minutes early on, hours later. */
function WeekTime({ seconds }: { seconds: number }) {
  const { t, span } = useT();
  const { value, noun } = span(seconds);
  return <CountTile value={value} label={t('ui.profile.stats.week', { noun })} />;
}

/**
 * Today's goal as a ring, at the size of a glyph.
 *
 * The narrow bar is one row at the foot of a phone and has no line to spend on
 * a sentence, but the one thing worth carrying there is the same thing the
 * card carries: whether today is still open. A ring says that without a word
 * and in the space the flame was using.
 *
 * `currentColor` for the track, so it is the button's own ink in both themes
 * and needs no palette of its own; the accent only on the part that is done.
 * A zero-length arc gets a square cap, because a round one at length nought
 * draws a dot — a reader who has watched nothing today would see a mark saying
 * they had.
 */
function DayRing({ goal }: { goal: DayGoal }) {
  const radius = 5;
  const circumference = 2 * Math.PI * radius;

  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
      <circle
        cx="6"
        cy="6"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.3"
        strokeWidth="1.5"
      />
      <circle
        cx="6"
        cy="6"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap={goal.fraction > 0 ? 'round' : 'butt'}
        strokeDasharray={`${circumference * goal.fraction} ${circumference}`}
        // From the top rather than from three o'clock: a ring that fills from
        // the side is read as a pie chart of something.
        transform="rotate(-90 6 6)"
        className="text-accent"
      />
    </svg>
  );
}

/** The desk, from anywhere a number on this card is pressed. */
function useDesk(): () => void {
  const navigate = useNavigate();
  return () => navigate(LEARN_PATH);
}
