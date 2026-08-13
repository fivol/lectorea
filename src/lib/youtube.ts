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
 */
export function embedSrc({
  playlistId,
  videoId,
  start,
}: {
  playlistId: string;
  videoId?: string | null;
  start?: number;
}): string {
  const path = videoId ? `embed/${videoId}` : 'embed/videoseries';
  const query = new URLSearchParams({
    list: playlistId,
    autoplay: '1',
    rel: '0',
    enablejsapi: '1',
    // Named so the player knows who it is allowed to answer.
    origin: window.location.origin,
  });
  if (start && start >= RESUME_FLOOR_SEC) query.set('start', String(Math.floor(start)));
  return `${YT_ORIGIN}/${path}?${query.toString()}`;
}

/** A saved position worth offering. Anything less is the beginning of the video. */
export function isResumable(sec: number | undefined): sec is number {
  return typeof sec === 'number' && sec >= RESUME_FLOOR_SEC;
}

type Options = {
  /** Off while nothing is playing — no listener, no handshake. */
  enabled: boolean;
  iframe: React.RefObject<HTMLIFrameElement>;
  /** Throttled, plus a final one whenever the lecture or the tab changes. */
  onPosition: (videoId: string, sec: number) => void;
  /** Once per lecture, when enough of it is behind the reader. */
  onWatched: (videoId: string) => void;
};

/**
 * Follows the player and reports what it sees.
 *
 * Returns the handler for the iframe's `load`: the handshake has to go out
 * after the frame exists, and React knows when that is.
 */
export function useYouTubeTracking({ enabled, iframe, onPosition, onWatched }: Options) {
  // Through refs so that a re-render — of which there is one per write — does
  // not tear the listener down and lose the handshake with it.
  const position = useRef(onPosition);
  const watched = useRef(onWatched);
  position.current = onPosition;
  watched.current = onWatched;

  const current = useRef<{ id: string; sec: number } | null>(null);
  const lastWrite = useRef(0);
  const counted = useRef(new Set<string>());

  const flush = useCallback(() => {
    const playing = current.current;
    if (!playing || !playing.sec) return;
    position.current(playing.id, playing.sec);
    lastWrite.current = Date.now();
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
      if (id && !current.current) current.current = { id, sec: 0 };
      if (!current.current) return;
      if (typeof sec === 'number') current.current.sec = sec;

      const at = current.current;
      const enough =
        typeof duration === 'number' && duration > 0 && at.sec / duration >= VIDEO_DONE_FRACTION;
      if ((enough || info.playerState === ENDED) && !counted.current.has(at.id)) {
        counted.current.add(at.id);
        watched.current(at.id);
        return; // A finished lecture keeps no position.
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
    };
  }, [enabled, flush, handshake]);

  return { onLoad: handshake };
}
