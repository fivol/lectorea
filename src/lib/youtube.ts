import { useCallback, useEffect, useRef } from 'react';
import { VIDEO_DONE_FRACTION } from '@shared/schema';

/**
 * Knowing what the embedded player is doing.
 *
 * YouTube's players talk to their host through `postMessage`, and an embed
 * loaded with `enablejsapi=1` answers a `listening` handshake with a stream of
 * `infoDelivery` frames — the current time, the duration, the player state and,
 * crucially, which video is in the frame. That last one is why this exists at
 * all: the embed is loaded with `list=`, so YouTube walks to the next lecture
 * on its own, and without listening we would lose the whole session after the
 * first one.
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
 * The fastest the tape can honestly move against the clock.
 *
 * Time watched is measured as the distance the playhead travelled between two
 * reports, and a seek travels an hour in no time at all. So the distance is
 * capped by how long it actually took, doubled — 2× is the quickest YouTube
 * plays anything, and a reader who watches at double speed did watch it.
 */
const MAX_RATE = 2;

/** Below this there is nothing to come back to — it is the start. */
const RESUME_FLOOR_SEC = 15;

/** YouTube's own state numbers; only the three that mean something here. */
const ENDED = 0;
const PLAYING = 1;

type Info = {
  currentTime?: number;
  duration?: number;
  playerState?: number;
  videoData?: { video_id?: string };
};

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
 * Follows the player and reports what it sees.
 *
 * Returns the handler for the iframe's `load`: the handshake has to go out
 * after the frame exists, and React knows when that is.
 */
export function useYouTubeTracking({ enabled, iframe, onPosition, onWatched, onEnded }: Options) {
  // Through refs so that a re-render — of which there is one per write — does
  // not tear the listener down and lose the handshake with it.
  const position = useRef(onPosition);
  const watched = useRef(onWatched);
  const ended = useRef(onEnded);
  position.current = onPosition;
  watched.current = onWatched;
  ended.current = onEnded;

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
      ? Math.max(0, Math.min(playing.sec - start.sec, ((now - start.at) / 1000) * MAX_RATE))
      : 0;
    from.current = { id: playing.id, sec: playing.sec, at: now };
    position.current(playing.id, playing.sec, played);
    lastWrite.current = now;
  }, []);

  const handshake = useCallback(() => {
    iframe.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }),
      YT_ORIGIN
    );
  }, [iframe]);

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
      if (payload.event !== 'infoDelivery' || !payload.info) return;

      const info = payload.info;
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
  }, [enabled, flush, handshake]);

  return { onLoad: handshake };
}
