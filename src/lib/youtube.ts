import { useCallback, useEffect, useRef, useState } from 'react';
import { VIDEO_DONE_FRACTION } from '@shared/schema';

/**
 * Knowing what the embedded player is doing, and telling it what to do.
 *
 * YouTube's players talk to their host through `postMessage`, and an embed
 * loaded with `enablejsapi=1` answers a `listening` handshake with a stream of
 * `infoDelivery` frames — the current time, the duration, the player state and,
 * crucially, which video is in the frame. That last one is why this exists at
 * all: the embed is loaded with `list=`, so YouTube walks to the next lecture
 * on its own, and without listening we would lose the whole session after the
 * first one.
 *
 * The same channel carries commands the other way (`command` frames), which is
 * the only way this side of the boundary can touch playback at all: an iframe
 * on another origin gets no keyboard events unless it holds focus, so YouTube's
 * own shortcuts stop working the moment the reader clicks anything of ours.
 * Anything the reader should be able to change about playback has to be a
 * control here — see `command`.
 *
 * The official `iframe_api` script does the same thing behind a nicer surface,
 * but it is a script fetched from `youtube.com` — the domain the embed is
 * deliberately not on. The handshake costs us thirty lines and keeps the only
 * third-party origin on the page the one already serving the video.
 *
 * No polling: the player emits about four frames a second by itself while
 * playing. All this does is throttle what reaches the profile.
 */

export const YT_ORIGIN = 'https://www.youtube-nocookie.com';

/** How often a position is worth writing down. Four a second is not. */
const WRITE_EVERY_MS = 5000;

/**
 * What the player offers until it has said so itself.
 *
 * It says so once, in the first delivery after the handshake, and the list has
 * been the same for years — but it is the player's list, not ours, so it is
 * read rather than assumed. **2× is the ceiling**, and asking for more does not
 * fail: `setPlaybackRate(3)` is answered with a frame reporting 2. Every rate
 * offered to the reader therefore comes from this list, so a button can never
 * promise a speed the player will quietly refuse.
 */
export const FALLBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/** Below this there is nothing to come back to — it is the start. */
const RESUME_FLOOR_SEC = 15;

/** YouTube's own state numbers; only the three that mean something here. */
const ENDED = 0;
const PLAYING = 1;

type Info = {
  currentTime?: number;
  duration?: number;
  playerState?: number;
  playbackRate?: number;
  availablePlaybackRates?: number[];
  videoData?: { video_id?: string };
};

/**
 * The other direction: one player command.
 *
 * The write half of the same `postMessage` protocol the handshake opened —
 * `func` is any method of the IFrame API (`setPlaybackRate`, `pauseVideo`,
 * `seekTo`), so a control the reader needs is a line here rather than a script
 * from `youtube.com`. Sending before the player is ready costs nothing: the
 * frame is dropped, which is why every command worth keeping is re-sent once
 * the player has spoken.
 */
export function command(
  iframe: React.RefObject<HTMLIFrameElement>,
  func: string,
  args: unknown[] = []
): void {
  iframe.current?.contentWindow?.postMessage(
    JSON.stringify({ event: 'command', func, args, id: 1, channel: 'widget' }),
    YT_ORIGIN
  );
}

/**
 * Where to start the iframe.
 *
 * `videoId` alongside `list` opens the playlist *at* that lecture, so the rail
 * of what comes next survives jumping into the middle of it. `start` is how a
 * resume is asked for — seeking after load is a race against the player's own
 * startup, and the parameter is not.
 *
 * `playlistId` is null for the playlists the player refuses to open by id —
 * see `listPlayable` in the schema. Then the frame carries one lecture and
 * nothing else, and walking to the next one becomes this app's job rather than
 * YouTube's.
 */
export function embedSrc({
  playlistId,
  videoId,
  start,
}: {
  playlistId: string | null;
  videoId?: string | null;
  start?: number;
}): string {
  const path = videoId ? `embed/${videoId}` : 'embed/videoseries';
  const query = new URLSearchParams({
    autoplay: '1',
    rel: '0',
    enablejsapi: '1',
    // Named so the player knows who it is allowed to answer.
    origin: window.location.origin,
  });
  if (playlistId) query.set('list', playlistId);
  if (start && start >= RESUME_FLOOR_SEC) query.set('start', String(Math.floor(start)));
  return `${YT_ORIGIN}/${path}?${query.toString()}`;
}

/**
 * Where to send a reader who wants this on YouTube itself.
 *
 * The playlist page is the better destination — it is the whole course — but it
 * is exactly as broken as the embed for the playlists the player refuses, so
 * those get the lecture instead.
 */
export function watchUrl(playlistId: string | null, videoId?: string | null): string {
  if (playlistId) return `https://www.youtube.com/playlist?list=${playlistId}`;
  return `https://www.youtube.com/watch?v=${videoId ?? ''}`;
}

/** A saved position worth offering. Anything less is the beginning of the video. */
export function isResumable(sec: number | undefined): sec is number {
  return typeof sec === 'number' && sec >= RESUME_FLOOR_SEC;
}

type Options = {
  /** Off while nothing is playing — no listener, no handshake. */
  enabled: boolean;
  iframe: React.RefObject<HTMLIFrameElement>;
  /**
   * The speed to open at — whatever the reader last chose. Read once: after
   * that the choice belongs to `setRate`, and a frame that loads later (the
   * next lecture, the dialog reopened) is put back to it, because a player
   * starts every video at 1× and a reader who set 1.5× set it for the course.
   */
  rate?: number;
  /** A speed the reader picked, worth remembering past this lecture. */
  onRate?: (rate: number) => void;
  /**
   * Throttled, plus a final one whenever the lecture or the tab changes.
   * `played` is how much of the lecture actually went past since the last
   * report — the seek-proof measure of time spent, see `MAX_RATE`.
   */
  onPosition: (videoId: string, sec: number, played: number) => void;
  /** Once per lecture, when enough of it is behind the reader. */
  onWatched: (videoId: string) => void;
  /**
   * The lecture actually ran out — not the same event as `onWatched`, which
   * fires at `VIDEO_DONE_FRACTION` with the last minutes still to play. Only
   * the frames loaded without `list=` need it: there is nothing behind them to
   * walk to, so the app walks instead.
   */
  onEnded?: (videoId: string) => void;
};

/**
 * Follows the player, reports what it sees, and carries the reader's speed back.
 *
 * Returns the handler for the iframe's `load` — the handshake has to go out
 * after the frame exists, and React knows when that is — alongside the playback
 * speed: what it is now, what the player will accept, and how to change it.
 */
export function useYouTubeTracking({
  enabled,
  iframe,
  rate = 1,
  onRate,
  onPosition,
  onWatched,
  onEnded,
}: Options) {
  // Through refs so that a re-render — of which there is one per write — does
  // not tear the listener down and lose the handshake with it.
  const position = useRef(onPosition);
  const watched = useRef(onWatched);
  const ended = useRef(onEnded);
  const remember = useRef(onRate);
  position.current = onPosition;
  watched.current = onWatched;
  ended.current = onEnded;
  remember.current = onRate;

  /** What the reader chose, and what every fresh frame is put back to. */
  const wanted = useRef(rate);
  /** What the player says it is doing — the strip follows the player, not us. */
  const speed = useRef(rate);
  const [shownRate, setShownRate] = useState(rate);
  const [rates, setRates] = useState<number[]>(FALLBACK_RATES);
  /** Cleared on every `load`, so each new frame is put back to `wanted` once. */
  const applied = useRef(false);
  /**
   * The fastest the tape ran since the last report.
   *
   * Time watched is the distance the playhead travelled between two reports,
   * and a seek travels an hour in no time at all — so the distance is capped by
   * how long it actually took, times the speed it was played at. The player is
   * the one that knows that speed, and it says so on the same channel.
   */
  const peak = useRef(rate);

  const current = useRef<{ id: string; sec: number } | null>(null);
  /**
   * Where the playhead was, and when — the two ends of the last stretch of
   * watching. Reset whenever the lecture changes, so a jump to another one is
   * never mistaken for an hour of it going past.
   */
  const from = useRef<{ id: string; sec: number; at: number } | null>(null);
  const lastWrite = useRef(0);
  const counted = useRef(new Set<string>());
  /** Lectures already walked away from, so one ending moves on exactly once. */
  const walked = useRef(new Set<string>());

  const flush = useCallback(() => {
    const playing = current.current;
    if (!playing || !playing.sec) return;
    const now = Date.now();
    const start = from.current?.id === playing.id ? from.current : null;
    const played = start
      ? Math.max(0, Math.min(playing.sec - start.sec, ((now - start.at) / 1000) * peak.current))
      : 0;
    from.current = { id: playing.id, sec: playing.sec, at: now };
    peak.current = speed.current;
    position.current(playing.id, playing.sec, played);
    lastWrite.current = now;
  }, []);

  const handshake = useCallback(() => {
    iframe.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }),
      YT_ORIGIN
    );
  }, [iframe]);

  /**
   * A speed the reader asked for.
   *
   * Set here and not waited for: the player answers with a frame of its own,
   * and if it refuses — anything above 2× it silently rounds down — that frame
   * is what the strip ends up showing. `wanted` keeps the ask, so the next
   * lecture opens at the speed this one is being watched at.
   */
  const setRate = useCallback(
    (next: number): void => {
      wanted.current = next;
      speed.current = next;
      peak.current = Math.max(peak.current, next);
      setShownRate(next);
      remember.current?.(next);
      command(iframe, 'setPlaybackRate', [next]);
    },
    [iframe]
  );

  /** The frame is new: the handshake goes out again, and so does the speed. */
  const onLoad = useCallback(() => {
    applied.current = false;
    handshake();
  }, [handshake]);

  useEffect(() => {
    if (!enabled) return;

    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== YT_ORIGIN) return;
      let payload: { event?: string; info?: Info };
      try {
        payload = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      } catch {
        return; // The player also sends frames that are not ours to read.
      }
      const info = payload.info;
      if (!info) return;

      /*
       * Speed first, and outside the `infoDelivery` gate below: the list of
       * rates arrives once, in the `initialDelivery` that answers the
       * handshake, and a rate that changes — by our command or in the player's
       * own menu — comes as a frame carrying nothing else. Reading it here is
       * what keeps the strip showing the player rather than our last click.
       */
      if (info.availablePlaybackRates?.length) {
        setRates((current) =>
          current.join() === info.availablePlaybackRates?.join()
            ? current
            : (info.availablePlaybackRates as number[])
        );
      }
      if (typeof info.playbackRate === 'number' && info.playbackRate !== speed.current) {
        speed.current = info.playbackRate;
        peak.current = Math.max(peak.current, info.playbackRate);
        setShownRate(info.playbackRate);
      }
      // The player has spoken, so it is up: whatever speed the reader is
      // watching this course at goes back in. A fresh frame always starts at
      // 1×, including the one YouTube's own autoplay brings in.
      if (!applied.current) {
        applied.current = true;
        if (wanted.current !== speed.current) command(iframe, 'setPlaybackRate', [wanted.current]);
      }

      if (payload.event !== 'infoDelivery') return;

      const id = info.videoData?.video_id;
      const sec = info.currentTime;
      const duration = info.duration;

      // Autoplay walked on to the next lecture: the one before it is finished
      // being watched, so its last known position is written before the
      // bookkeeping moves across.
      if (id && current.current && current.current.id !== id) {
        flush();
        current.current = null;
      }
      if (id && !current.current) {
        current.current = { id, sec: 0 };
        // Where this one is starting from, which after a resume is the middle
        // of it: measuring the first stretch from zero would book twenty
        // minutes nobody watched today.
        from.current = { id, sec: typeof sec === 'number' ? sec : 0, at: Date.now() };
      }
      if (!current.current) return;
      if (typeof sec === 'number') current.current.sec = sec;

      const at = current.current;
      const finished = info.playerState === ENDED;
      const enough =
        typeof duration === 'number' && duration > 0 && at.sec / duration >= VIDEO_DONE_FRACTION;
      if ((enough || finished) && !counted.current.has(at.id)) {
        counted.current.add(at.id);
        watched.current(at.id);
        if (!finished) return; // A finished lecture keeps no position.
      }
      // Running out is its own event: `onWatched` has usually fired minutes
      // ago, at `VIDEO_DONE_FRACTION`, and the lecture was still playing. Only
      // a frame loaded without `list=` has anything to do about it, which is
      // why `onEnded` is undefined for every other one.
      if (finished) {
        if (!walked.current.has(at.id)) {
          walked.current.add(at.id);
          ended.current?.(at.id);
        }
        return;
      }

      if (info.playerState !== undefined && info.playerState !== PLAYING) {
        flush(); // Paused, buffering, stopped — all of them are a good moment.
        return;
      }
      if (Date.now() - lastWrite.current >= WRITE_EVERY_MS) flush();
    };

    // The frame may already be up — a remount for a new lecture arrives with
    // its `load` long gone — so the handshake is also offered a few times on a
    // timer, and the player answers whichever one lands after it is ready.
    applied.current = false;
    const retries = [0, 400, 1200, 2500].map((delay) => setTimeout(handshake, delay));

    window.addEventListener('message', onMessage);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);

    return () => {
      retries.forEach(clearTimeout);
      window.removeEventListener('message', onMessage);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
      flush();
      current.current = null;
      from.current = null;
    };
  }, [enabled, flush, handshake, iframe]);

  return { onLoad, rate: shownRate, rates, setRate };
}
