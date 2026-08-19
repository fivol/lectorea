import { describe, expect, it } from 'vitest';
import { parseYoutubeRef } from '../shared/youtube';

/**
 * The search box takes pasted addresses, and every reader pastes a different
 * one: the playlist page, a lecture out of the middle of it, the share form,
 * the mobile host, sometimes the bare id. They all name the same playlist, and
 * the catalogue holds that id already — so what the feature costs is exactly
 * this file being right.
 */

const PLAYLIST = 'PLxAS2LmzGbYQqTvXcHqAOKcTv5nOEUmJ4';
const VIDEO = 'dQw4w9WgXcQ';

describe('playlist links', () => {
  it.each([
    `https://www.youtube.com/playlist?list=${PLAYLIST}`,
    `http://youtube.com/playlist?list=${PLAYLIST}`,
    `www.youtube.com/playlist?list=${PLAYLIST}`,
    `youtube.com/playlist?list=${PLAYLIST}`,
    `https://m.youtube.com/playlist?list=${PLAYLIST}`,
    `https://music.youtube.com/playlist?list=${PLAYLIST}`,
    `https://www.youtube-nocookie.com/embed/videoseries?list=${PLAYLIST}`,
    // The share form's own parameter, and a link copied out of a running lecture.
    `https://www.youtube.com/playlist?list=${PLAYLIST}&si=aBcDeF`,
    `https://www.youtube.com/watch?v=${VIDEO}&list=${PLAYLIST}&index=7`,
    `https://youtu.be/${VIDEO}?list=${PLAYLIST}&t=93`,
    `https://www.youtube.com/embed/${VIDEO}?list=${PLAYLIST}`,
    // The browse form, and the id on its own.
    `https://www.youtube.com/playlist?list=VL${PLAYLIST}`,
    PLAYLIST,
    `  ${PLAYLIST}  `,
  ])('reads %s', (link) => {
    expect(parseYoutubeRef(link)).toEqual({ kind: 'playlist', id: PLAYLIST, catalogable: true });
  });

  it('keeps the case, because YouTube ids are case-sensitive', () => {
    const ref = parseYoutubeRef(`https://www.youtube.com/playlist?list=${PLAYLIST}`);
    expect(ref?.id).toBe(PLAYLIST);
    expect(ref?.id).not.toBe(PLAYLIST.toLowerCase());
  });
});

describe('the other three kinds', () => {
  it.each([
    `https://www.youtube.com/watch?v=${VIDEO}`,
    `https://youtu.be/${VIDEO}`,
    `https://youtu.be/${VIDEO}?si=aBcDeF`,
    `https://www.youtube.com/shorts/${VIDEO}`,
    `https://www.youtube.com/live/${VIDEO}`,
    `https://www.youtube.com/embed/${VIDEO}`,
  ])('reads %s as one video', (link) => {
    expect(parseYoutubeRef(link)).toEqual({ kind: 'video', id: VIDEO });
  });

  it('reads a channel by id, by handle and by the two legacy paths', () => {
    const id = 'UCabcdefghijklmnopqrstuv';
    expect(parseYoutubeRef(`https://www.youtube.com/channel/${id}`)).toEqual({
      kind: 'channel',
      id,
    });
    expect(parseYoutubeRef('https://www.youtube.com/@lectorium')).toEqual({
      kind: 'channel',
      id: '@lectorium',
    });
    expect(parseYoutubeRef('https://www.youtube.com/c/lectorium')?.kind).toBe('channel');
    expect(parseYoutubeRef('https://www.youtube.com/user/lectorium')?.kind).toBe('channel');
  });

  it('answers the uploads feed as the channel it is', () => {
    // `UU…` is everything a channel published, and its id is the channel's own
    // with two letters changed — not a playlist anybody assembled.
    expect(parseYoutubeRef('https://www.youtube.com/playlist?list=UUabcdefghijklmnopqrstuv')).toEqual(
      { kind: 'channel', id: 'UCabcdefghijklmnopqrstuv' }
    );
  });

  it.each(['WL', 'LM', 'LLabcdefghij', 'RDMMabcdefghij', 'TLGGabcdefghij'])(
    'tells a personal list (%s) apart from a playlist',
    (list) => {
      expect(parseYoutubeRef(`https://www.youtube.com/playlist?list=${list}`)?.kind).toBe(
        'personal'
      );
    }
  );
});

describe('what is not a link', () => {
  it.each([
    'теория вероятностей',
    'youtube лекции',
    'mit 18.06',
    '',
    '   ',
    // Eleven characters of latin — the shape of a video id, and of a word
    // somebody is searching for. A bare video id is deliberately not read.
    'Probability',
    'vimeo.com/playlist?list=PL123',
    'https://www.youtube.com/',
    'https://www.youtube.com/results?search_query=matan',
  ])('leaves %s to the ordinary search', (text) => {
    expect(parseYoutubeRef(text)).toBeNull();
  });
});

describe('what the catalogue could hold', () => {
  it('marks the three forms the crawl has ever resolved', () => {
    // `shared/playlist-id.ts` is the count behind these: PL + 32, PL + 16 hex,
    // PL + a video id. Nothing else has ever answered.
    expect(parseYoutubeRef(`https://www.youtube.com/playlist?list=${PLAYLIST}`)?.catalogable).toBe(
      true
    );
    expect(
      parseYoutubeRef('https://www.youtube.com/playlist?list=PL7590BF3B139A354D')?.catalogable
    ).toBe(true);
  });

  it('reads a music album as a playlist, and does not offer it', () => {
    // A real address that resolves for everybody, and never a course — so it is
    // read and found or missed like any other, but never proposed.
    const ref = parseYoutubeRef(
      'https://music.youtube.com/playlist?list=OLAK5uy_abcdefghijklmnopqrstuvwxyz01234'
    );
    expect(ref?.kind).toBe('playlist');
    expect(ref?.catalogable).toBe(false);
  });
});
