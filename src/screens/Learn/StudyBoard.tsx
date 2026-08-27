import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BuiltCourse } from '@shared/schema';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { useGoals } from '@/lib/goals';
import { useProfile } from '@/store/profile';
import EmptyState from '@/components/EmptyState';
import ContinueCard from './ContinueCard';
import CourseCard from './CourseCard';
import { useProfileNavigation } from './navigate';
import { PlaylistGrid, PlaylistsExpanded, useFavoritePlaylists } from './PlaylistsSection';
import ProfileStats from './ProfileStats';
import RecentSection, { ClearRecent } from './RecentSection';
import SyncNudge from './SyncNudge';
import Section, { ExpandedSection } from './Section';

/**
 * Everything a reader has done here, on one screen.
 *
 * Courses and playlists used to be two tabs, and they answered the same
 * question twice: a saved playlist is a course you meant to watch, and a course
 * in progress is a playlist you are watching. Splitting them meant that nothing
 * anywhere said what somebody was actually in the middle of — you had to know
 * which half of your own studying you were looking for before you could look.
 *
 * So: one tab, read top to bottom as the routine it describes. The numbers, the
 * lecture that was playing when you stopped, what you are studying, what you
 * are aiming at, what you saved for later, what you had open lately, what is
 * behind you. Each shelf shows a handful and opens into the whole of itself —
 * without leaving the profile, because none of this is a different place.
 */

const PREVIEW = { studying: 4, favorite: 4, playlists: 3, recent: 3, done: 4 } as const;

type SectionKey = keyof typeof PREVIEW;

export default function LearningTab({ onOpenData }: { onOpenData: () => void }) {
  const catalog = useCatalog();
  const { t } = useT();
  const profile = useProfile((state) => state.profile);
  const { toMap } = useProfileNavigation();

  const [open, setOpen] = useState<SectionKey | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Opening a shelf is a move, and a move that lands halfway down the previous
  // page is a move nobody can follow. The scroller belongs to the panel, so it
  // is found rather than held.
  useEffect(() => {
    rootRef.current?.closest('.panel-scroll')?.scrollTo({ top: 0 });
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
    <div ref={rootRef} className="p-4">
      {empty ? (
        <EmptyState
          icon="star"
          text={t('ui.profile.empty')}
          action={{ label: t('ui.profile.toMap'), onClick: toMap }}
        />
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
          <ProfileStats />
          {/* Under the numbers rather than over them: the line is a footnote to
              «вот ваш прогресс», and it only has a point once there is one. */}
          <SyncNudge onOpenData={onOpenData} />
          <ContinueCard />

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

function CourseGrid({ courses, mode }: { courses: BuiltCourse[]; mode: 'path' | 'course' }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {courses.map((course) => (
        <CourseCard key={course.id} course={course} mode={mode} />
      ))}
    </div>
  );
}
