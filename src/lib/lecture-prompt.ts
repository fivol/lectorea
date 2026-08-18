import type { BuiltPlaylist, Video } from '@shared/schema';
import type { Translator } from '@/i18n';
import type { Catalog } from '@/lib/data';
import { formatDuration } from '@/lib/format';
import { momentUrl } from '@/lib/youtube';

/**
 * The lecture on screen said in words, for an assistant that is not this site.
 *
 * A question asked in the middle of a lecture is almost never answerable on its
 * own — «why does that have to be orthogonal» needs to know which course this
 * is, which recording of it, and which minute. The reader has all of that on
 * screen and none of it in the clipboard, so the press collects it: the course
 * and what it stands on, the recording and who reads it, the lecture and its
 * number in the queue, and the second the playhead is at, as a link that opens
 * there.
 *
 * **What it deliberately does not carry is the subtitles.** They cannot be had
 * from here: `timedtext` answers a browser with an empty 200, and so does the
 * signed URL out of the watch page — YouTube wants a proof-of-origin token
 * neither of them has. What *can* have them is the assistant on the other end,
 * if it has a terminal, so the prompt carries the command that works instead of
 * the text it produces. That command is not the obvious one — see
 * `docs/agents/data-traps.md`; the plain `yt-dlp --write-auto-subs` is answered
 * with «has no subtitles», and only the android client still hands them over.
 *
 * And it has to survive the assistant that cannot run anything at all, which is
 * most of them: the last line says so, because an assistant that quietly
 * invents the content of a lecture it never saw is worse than one that says it
 * could not look.
 *
 * **Everything past the playhead is unseen, and the prompt says so once.** The
 * reader has watched up to this second and no further, so an answer resting on
 * the next twenty minutes answers a question they have not reached yet and
 * spoils the lecture on the way. That is why the transcript is asked for
 * *behind* the moment rather than around it, and why the rule is written as its
 * own line: it governs the whole answer, not only which minutes get read.
 */

/** Prerequisites worth naming before the line stops being read. */
const DEPS_SHOWN = 4;

/** How much of the lecture *before* the playhead the question is likely about. */
const WINDOW_MIN = 2;

export type LecturePromptInput = {
  playlist: BuiltPlaylist;
  video: Video;
  /** Which lecture in the queue, zero-based — printed the way the queue numbers it. */
  index: number;
  /** Where the playhead stands, in seconds. */
  sec: number;
  catalog: Catalog;
  t: Translator;
};

export function lecturePrompt({
  playlist,
  video,
  index,
  sec,
  catalog,
  t: { t },
}: LecturePromptInput): string {
  const course = catalog.courseById.get(playlist.courseId);
  const url = momentUrl(video.id, sec);
  /*
   * The lecture with nothing on it, for the command line.
   *
   * `momentUrl` is the link a person follows, and its `&t=` is exactly what a
   * command does not want: yt-dlp reads the id and ignores the rest, but the
   * line is also read by whoever is about to run it, and a second's timecode in
   * an argument that has nothing to do with seconds reads as a mistake.
   */
  const source = `https://youtu.be/${video.id}`;
  const time = formatDuration(Math.max(0, Math.floor(sec)));

  const lines: string[] = [t('ui.ask.intro'), ''];

  if (course) {
    lines.push(
      t('ui.ask.course', {
        title: t(`course.${playlist.courseId}.title`),
        domain: t(`domain.${course.domains[0]}.title`),
      })
    );
    /*
     * What the lecture is standing on, straight out of the graph.
     *
     * This is the one thing in the prompt an assistant could not have worked
     * out for itself, and the reason a question answered from it lands at the
     * right level: «explain this» to somebody who has done linear algebra is a
     * different answer from the same words to somebody who has not.
     */
    const deps = course.deps
      .filter((id) => catalog.courseById.has(id))
      .slice(0, DEPS_SHOWN)
      .map((id) => t(`course.${id}.title`));
    if (deps.length) lines.push(t('ui.ask.needs', { list: deps.join(', ') }));
  }

  lines.push(
    t('ui.ask.recording', {
      title: playlist.title,
      author: playlist.lecturer || playlist.channelTitle,
      lang: playlist.lang,
    }),
    t('ui.ask.lecture', {
      n: index + 1,
      total: playlist.videos.length,
      title: video.title,
    }),
    t('ui.ask.moment', { time, duration: formatDuration(video.seconds), url }),
    t('ui.ask.sofar'),
    '',
    t('ui.ask.subs'),
    t('ui.ask.command', { langs: subLangs(playlist), url: source }),
    t('ui.ask.window', { time, minutes: WINDOW_MIN }),
    t('ui.ask.fallback'),
    '',
    t('ui.ask.question')
  );

  return lines.join('\n');
}

/**
 * Which subtitle languages to ask for.
 *
 * `captions` is what the API calls a caption track, and the API only counts the
 * ones a human uploaded — a lecture it reports as having none still has the
 * automatic transcript, which is what a question about the twentieth minute
 * actually needs. So the recording's own language always goes in the list,
 * whatever the field says, and `--write-auto-subs` does the rest.
 */
function subLangs(playlist: BuiltPlaylist): string {
  return [...new Set([...playlist.captions, playlist.lang].filter(Boolean))].join(',');
}
