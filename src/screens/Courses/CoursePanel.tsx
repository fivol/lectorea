import { useEffect, useMemo } from 'react';
import type { BuiltCourse } from '@shared/schema';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { formatHours, hoursFromSeconds, inkOn, withAlpha } from '@/lib/format';
import { percent, useCourseProgress } from '@/lib/progress';
import { fixDataUrl, suggestPlaylistUrl } from '@/lib/repo';
import { useProfile, useResolvedTheme } from '@/store/profile';
import { useUi } from '@/store/ui';
import ProgressBar from '@/components/ProgressBar';
import { Button, Chip, IconButton } from '@/components/ui';
import LinksBlock from './LinksBlock';
import PlaylistList from './PlaylistList';

type Props = {
  course: BuiltCourse;
  search: string;
  /** Clears the selection. Absent on mobile, where the sheet has its own close. */
  onClose?: () => void;
  /**
   * Whether the panel is its own scrollport. It is everywhere but in the phone
   * sheet, which scrolls itself: the sheet's own gesture has to know how far
   * the text has been scrolled to tell a drag on it from a read of it.
   */
  scroll?: boolean;
};

/** Everything known about the selected course, in the order it is needed. */
export default function CoursePanel({
  course,
  search,
  onClose,
  scroll = true,
}: Props) {
  const { t, count, has } = useT();
  const catalog = useCatalog();
  const status = useProfile((state) => state.profile.courses[course.id]?.status ?? null);
  const favorite = useProfile((state) => state.profile.courses[course.id]?.favorite ?? false);
  const cycleStatus = useProfile((state) => state.cycleCourseStatus);
  const toggleFavorite = useProfile((state) => state.toggleCourseFavorite);
  const setEcho = useUi((state) => state.setEcho);
  const scheme = useResolvedTheme();
  // Its own shard and nothing else — the path's courses are `LinksBlock`'s
  // business, and asking for eight more here would make opening any course
  // cost the whole chain behind it.
  const own = useMemo(() => [course.id], [course.id]);
  const progress = useCourseProgress(own).get(course.id) ?? null;

  /**
   * The echo is set by hovering a link in here and cleared on mouse-out — but
   * closing the panel unmounts it from under the cursor, so that mouse-out
   * never arrives and the highlight stays pinned to a course nothing is
   * pointing at any more. Clearing on unmount covers every way the panel can go
   * away: the ×, a click on the background, a filter change, navigation.
   */
  useEffect(() => () => setEcho(null), [setEcho]);

  const domains = course.domains
    .map((id) => catalog.domainById.get(id))
    .filter((domain): domain is NonNullable<typeof domain> => Boolean(domain));

  return (
    <div className={scroll ? 'panel-scroll h-full' : ''}>
      <header className="px-4 pb-3 pt-4">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {domains.map((domain) => (
            <Chip
              key={domain.id}
              to={`/courses?domain=${encodeURIComponent(domain.id)}`}
              hint={t('ui.legend.domain')}
              style={{ color: inkOn(domain.color, scheme), borderColor: withAlpha(domain.color, 0.4) }}
            >
              {t(`domain.${domain.id}.title`)}
            </Chip>
          ))}
          {/* Four chips in a row, each a number or a word out of context — every
              one of them says what it is when the pointer stops on it. */}
          <Chip className="num" hint={t('ui.legend.stage')}>
            {t(`ui.stage.${course.stage}`)}
          </Chip>
          <Chip className="num" hint={t('ui.legend.level')}>
            {t('ui.course.level', { n: course.level + 1 })}
          </Chip>
          {course.hours ? (
            <Chip className="num" hint={t('ui.legend.hours')}>
              {t('ui.course.hoursShort', { n: formatHours(course.hours) })}
            </Chip>
          ) : null}
          {onClose ? (
            <IconButton
              icon="close"
              iconSize={14}
              label={t('ui.course.deselect')}
              className="ml-auto"
              onClick={onClose}
            />
          ) : null}
        </div>

        <h2 className="font-display text-h1">{t(`course.${course.id}.title`)}</h2>

        {/* The names the same course goes by elsewhere. Half the recordings in
            the catalogue are titled with one of these rather than with ours,
            and someone who took ТФКП has no other way to tell that this is it. */}
        {has(`course.${course.id}.aliases`) ? (
          <p className="mt-1 text-sm text-ink-faint">{t(`course.${course.id}.aliases`)}</p>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-1.5">
          <Button
            variant={favorite ? 'primary' : 'default'}
            icon={favorite ? 'star-filled' : 'star'}
            iconSize={16}
            onClick={() => toggleFavorite(course.id)}
            aria-pressed={favorite}
          >
            {favorite ? t('ui.course.favoriteOn') : t('ui.course.favorite')}
          </Button>
          {/* The label names what the click does, not what the course already
              is — "Не начат" beside a dot read as a disabled badge. The state
              is still legible, from the icon and the filled button. */}
          <Button
            variant={status ? 'primary' : 'default'}
            icon={status === 'done' ? 'check' : status === 'in_progress' ? 'half' : 'circle'}
            iconSize={16}
            onClick={() => cycleStatus(course.id)}
            title={t('ui.course.statusToggle')}
          >
            {status === 'done'
              ? t('ui.course.done')
              : status === 'in_progress'
                ? t('ui.course.finish')
                : t('ui.course.start')}
          </Button>
        </div>

        {/*
          The lectures behind this course, by the recording being watched.

          Only once there are any — before that the line would say «0 из 30» of
          a playlist nobody has chosen yet, which is a fact about the catalogue
          rather than about the reader. It names the recording, because a course
          carries a dozen and a bare «12 из 30» does not say which twelve.
        */}
        {progress ? (
          <div className="mt-3">
            <ProgressBar
              done={progress.done}
              total={progress.total}
              fill={progress.fraction}
              label={`${percent(progress.fraction)}%`}
            />
            <p className="mt-1 truncate text-[11px] text-ink-faint">
              <span className="num">
                {t('ui.course.lecturesDone', { done: progress.done, total: progress.total })}
                {' · '}
                {t('ui.playlist.hoursOf', {
                  n: formatHours(hoursFromSeconds(progress.watchedSeconds)),
                  of: formatHours(hoursFromSeconds(progress.totalSeconds)),
                })}
              </span>
              {' · '}
              {progress.playlist.lecturer ?? progress.playlist.channelTitle}
            </p>
          </div>
        ) : null}
      </header>

      <section className="px-4 pb-4">
        <p className="text-body text-ink-dim">
          {has(`course.${course.id}.desc`)
            ? t(`course.${course.id}.desc`)
            : t('ui.course.description.missing')}
        </p>
      </section>

      {/* Where the course sits — what it needs, what it opens, the whole path —
          in one folded block, so that the playlists the panel is opened for are
          not three sections of neighbouring courses away. See `LinksBlock`. */}
      <LinksBlock course={course} search={search} />

      <PlaylistList course={course} />

      <footer className="flex flex-wrap gap-3 border-t border-line px-4 py-3 text-xs text-ink-faint">
        <a
          href={fixDataUrl(course.id, course.domains[0])}
          target="_blank"
          rel="noreferrer noopener"
          className="hover:text-ink-dim"
        >
          {t('ui.course.fixData')}
        </a>
        <a
          href={suggestPlaylistUrl(course.id)}
          target="_blank"
          rel="noreferrer noopener"
          className="hover:text-ink-dim"
        >
          {t('ui.course.suggestPlaylist')}
        </a>
        <span className="ml-auto">{count(course.playlistCount, 'playlist')}</span>
      </footer>
    </div>
  );
}
