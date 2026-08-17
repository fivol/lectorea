import type { Video } from '@shared/schema';
import { useT } from '@/i18n';
import { formatDuration } from '@/lib/format';
import ProgressBar from '@/components/ProgressBar';
import { Button, IconButton } from '@/components/ui';

type Props = {
  video: Video;
  /** Its place in the recording, counted from one for the reader. */
  index: number;
  total: number;
  /** Where the playhead is, as the player last reported it. */
  at: number;
  done: boolean;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  onToggleDone: () => void;
};

/**
 * What is playing, said under the frame: which lecture of how many, how far
 * into it, and the three things a reader reaches for while watching.
 *
 * It exists because the frame cannot say any of it. A YouTube embed shows the
 * lecture's own title and the playlist's position only while its chrome is up,
 * and its chrome goes away a second after the pointer does — so the one screen
 * somebody spends an hour on would otherwise carry no answer to «which of these
 * am I on» that did not require moving the mouse.
 *
 * The position is the player's own report rather than the profile's stored one:
 * «Место остановки» can be switched off, and a reader who has turned off *being
 * remembered* has not asked to stop being *shown* where they are.
 */
export default function NowPlaying({
  video,
  index,
  total,
  at,
  done,
  onPrev,
  onNext,
  onToggleDone,
}: Props) {
  const { t } = useT();
  const seconds = Math.max(1, video.seconds);
  // A finished lecture reads as full even when the frame has just been opened
  // at the start of it again: the tick is the statement, the playhead is not.
  const played = done ? seconds : Math.min(at, seconds);

  return (
    <div className="shrink-0 border-b border-line px-4 py-2.5">
      {/* `.ink-soft` and not `--c-ink-faint`: faint is for what a reader is
          meant to skip, and «лекция 2 из 26» is the line that says where they
          are in the course. */}
      <p className="num ink-soft text-[11px]">{t('ui.player.lectureOf', { n: index + 1, total })}</p>
      <p className="mt-0.5 line-clamp-2 text-sm font-medium leading-snug text-ink">{video.title}</p>

      {/* The player's own scrubber says this too — and hides itself a second
          after the pointer leaves, which is most of an hour. */}
      <ProgressBar
        className="mt-2"
        done={Math.round(played)}
        total={seconds}
        fill={played / seconds}
        label={
          <>
            <span className="text-accent">{formatDuration(played)}</span>
            <span className="px-0.5 text-ink-faint">/</span>
            {formatDuration(video.seconds)}
          </>
        }
      />

      {/*
        Two glyphs and a word. Back and forward are the shape they have worn on
        every player there has ever been and need no label beside a running
        lecture; marking one off is a claim about the reader's own progress,
        and a claim is worth a word.
      */}
      <div className="mt-2 flex items-center gap-1.5">
        <IconButton
          icon="chevron-left"
          label={t('ui.player.prevLecture')}
          disabled={!onPrev}
          className="disabled:pointer-events-none disabled:opacity-40"
          onClick={() => onPrev?.()}
        />
        <IconButton
          icon="chevron-right"
          label={t('ui.player.nextLecture')}
          disabled={!onNext}
          className="disabled:pointer-events-none disabled:opacity-40"
          onClick={() => onNext?.()}
        />
        <Button
          small
          variant={done ? 'primary' : 'default'}
          icon="check"
          iconSize={14}
          className="ml-auto"
          onClick={onToggleDone}
        >
          {done ? t('ui.player.lectureDone') : t('ui.playlist.markWatched')}
        </Button>
      </div>
    </div>
  );
}
