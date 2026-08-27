import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BuiltCourse } from '@shared/schema';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { useGoals } from '@/lib/goals';
import { useResumeList } from '@/lib/progress';
import { useProfile } from '@/store/profile';
import { ContinueOffer } from '@/components/ContinueBlock';
import { ResumeStepper, useResumeCarousel } from '@/components/ResumeCard';
import TodayLine from '@/components/game/TodayLine';
import EmptyState from '@/components/EmptyState';
import CourseCard from './CourseCard';
import { useProfileNavigation } from './navigate';
import NextUp from './NextUp';
import { PlaylistGrid, PlaylistsExpanded, useFavoritePlaylists } from './PlaylistsSection';
import ProfileStats from './ProfileStats';
import RecentSection, { ClearRecent } from './RecentSection';
import AccountRow from './AccountRow';
import Section, { ExpandedSection } from './Section';

/**
 * The desk: everything a reader has done here, and the one press that carries
 * it on.
 *
 * Courses and playlists used to be two tabs, and they answered the same
 * question twice: a saved playlist is a course you meant to watch, and a course
 * in progress is a playlist you are watching. Splitting them meant that nothing
 * anywhere said what somebody was actually in the middle of — you had to know
 * which half of your own studying you were looking for before you could look.
 *
 * So: one page, read top to bottom as the routine it describes. What was
 * playing when you stopped, what today has come to, what the catalogue has
 * opened up for you, the numbers, then the shelves — what you are studying,
 * what you are aiming at, what you saved for later, what you had open lately,
 * what is behind you. Each shelf shows a handful and opens into the whole of
 * itself without leaving the page, because none of that is a different place.
 *
 * The order is the three horizons, in the order a reader meets them: **the
 * day** at the top, where the press that answers it is; **the week** in the
 * numbers, where looking back is the point; and the objects — courses,
 * recordings, paths — on the shelves under both. See
 * `docs/agents/practices.md`, "which horizon a number belongs to".
 */

const PREVIEW = { studying: 4, favorite: 4, playlists: 3, recent: 3, done: 4 } as const;

type SectionKey = keyof typeof PREVIEW;

export default function StudyBoard() {
  const catalog = useCatalog();
  const { t } = useT();
  const profile = useProfile((state) => state.profile);
  const { toMap } = useProfileNavigation();

  const [open, setOpen] = useState<SectionKey | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Opening a shelf is a move, and a move that lands halfway down the previous
  // page is a move nobody can follow. The scroller is the page itself now that
  // this is one; `closest` still finds a panel's own if it is ever put in one.
  useEffect(() => {
    if (!open) return;
    const scroller = rootRef.current?.closest('.panel-scroll');
    if (scroller) scroller.scrollTo({ top: 0 });
    else window.scrollTo({ top: 0 });
  }, [open]);

  const goals = useGoals();
  const playlists = useFavoritePlaylists(
    open === 'playlists' ? undefined : PREVIEW.playlists
  );

  const groups = useMemo(() => {
    const studying: BuiltCourse[] = [];
    const done: BuiltCourse[] = [];
    for (const [id, entry] of Object.entries(profile.courses)) {
      const course = catalog.courseById.get(id);
      if (!course) continue;
      if (entry.status === 'in_progress') studying.push(course);
      if (entry.status === 'done') done.push(course);
    }
    return { studying, done };
  }, [profile.courses, catalog]);

  const empty =
    !groups.studying.length &&
    !groups.done.length &&
    !goals.length &&
    !playlists.total &&
    !profile.recent.length;

  const sections: Record<SectionKey, { title: string; toolbar?: ReactNode; body: ReactNode }> = {
    studying: {
      title: t('ui.profile.group.in_progress'),
      body: <CourseGrid courses={groups.studying} mode="course" />,
    },
    favorite: {
      title: t('ui.profile.group.favorite'),
      body: (
        <div className="grid gap-3 sm:grid-cols-2">
          {goals.map((goal) => (
            <CourseCard key={goal.course.id} course={goal.course} mode="path" steps={goal.steps} />
          ))}
        </div>
      ),
    },
    playlists: {
      title: t('ui.profile.group.playlists'),
      body: <PlaylistsExpanded />,
    },
    recent: {
      title: t('ui.profile.group.recent'),
      toolbar: <ClearRecent />,
      body: <RecentSection />,
    },
    done: {
      title: t('ui.profile.group.done'),
      body: <CourseGrid courses={groups.done} mode="course" />,
    },
  };

  return (
    <div ref={rootRef}>
      {empty ? (
        <div className="space-y-6">
          <EmptyState
            icon="star"
            text={t('ui.profile.empty')}
            action={{ label: t('ui.profile.toMap'), onClick: toMap }}
          />
          {/* The other reason a desk is empty: this is the phone, and the
              studying is on the laptop. See `AccountRow`. */}
          <AccountRow empty />
        </div>
      ) : open ? (
        <ExpandedSection
          title={sections[open].title}
          toolbar={sections[open].toolbar}
          onBack={() => setOpen(null)}
        >
          {sections[open].body}
        </ExpandedSection>
      ) : (
        <div className="space-y-8">
          <ContinueSection />
          <NextUp />
          <ProfileStats />
          {/* Under the numbers rather than over them: it is a footnote to «вот
              ваш прогресс» — where that progress is kept, and how to have it on
              the other device. See `AccountRow`. */}
          <AccountRow />

          {groups.studying.length ? (
            <Section
              title={sections.studying.title}
              count={groups.studying.length}
              onExpand={
                groups.studying.length > PREVIEW.studying ? () => setOpen('studying') : undefined
              }
            >
              <CourseGrid courses={groups.studying.slice(0, PREVIEW.studying)} mode="course" />
            </Section>
          ) : null}

          {goals.length ? (
            <Section
              title={sections.favorite.title}
              hint={t('ui.profile.group.favorite.hint')}
              count={goals.length}
              onExpand={goals.length > PREVIEW.favorite ? () => setOpen('favorite') : undefined}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                {goals.slice(0, PREVIEW.favorite).map((goal) => (
                  <CourseCard
                    key={goal.course.id}
                    course={goal.course}
                    mode="path"
                    steps={goal.steps}
                  />
                ))}
              </div>
            </Section>
          ) : null}

          {playlists.total ? (
            <Section
              title={sections.playlists.title}
              count={playlists.total}
              onExpand={
                playlists.total > PREVIEW.playlists ? () => setOpen('playlists') : undefined
              }
            >
              <PlaylistGrid playlists={playlists.playlists} />
            </Section>
          ) : null}

          {profile.recent.length ? (
            <Section
              title={sections.recent.title}
              count={profile.recent.length}
              onExpand={
                profile.recent.length > PREVIEW.recent ? () => setOpen('recent') : undefined
              }
            >
              <RecentSection limit={PREVIEW.recent} />
            </Section>
          ) : null}

          {groups.done.length ? (
            <Section
              title={sections.done.title}
              count={groups.done.length}
              onExpand={groups.done.length > PREVIEW.done ? () => setOpen('done') : undefined}
            >
              <CourseGrid courses={groups.done.slice(0, PREVIEW.done)} mode="course" />
            </Section>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * The offer, and the day it belongs to, at the top of the page.
 *
 * One decision in one block: «Продолжить» is the press, and «ещё 20 минут» is
 * the ask that press answers. They were three screens apart before the card on
 * the map put them together, and this is the same pair on the page that card
 * is a shortcut into — the same components reading the same log, so the two
 * cannot disagree about tonight.
 *
 * The arrows are here for the same reason they are on the card: a reader with
 * three recordings on the go was being offered one of them and told nothing
 * about the other two.
 */
function ContinueSection() {
  const { t } = useT();
  const resumes = useResumeList();
  const { current, index, count, prev, next } = useResumeCarousel(resumes);

  if (!current) return null;

  return (
    <section className="surface p-3 sm:p-4">
      <header className="mb-2 flex items-center gap-2">
        <h3 className="mono-label min-w-0 flex-1 truncate text-ink-dim">{t('ui.home.title')}</h3>
        <ResumeStepper index={index} count={count} onPrev={prev} onNext={next} />
      </header>
      <ContinueOffer resume={current} />
      {/* Indented to the offer's own padding, so the sentence starts under the
          word «Продолжить» rather than under the still beside it. */}
      <TodayLine className="mt-1 px-1" />
    </section>
  );
}

function CourseGrid({ courses, mode }: { courses: BuiltCourse[]; mode: 'path' | 'course' }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {courses.map((course) => (
        <CourseCard key={course.id} course={course} mode={mode} />
      ))}
    </div>
  );
}
