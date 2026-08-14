import { describe, expect, it } from 'vitest';
import { isPlaylistId, playlistIdsIn } from '../scripts/lib/playlist-id.js';

/**
 * The regression these guard is the one in the module's own header: a range
 * quantifier where the comment promised a choice, so an id run into trailing
 * junk was truncated to something plausible instead of refused. The truncation
 * is the expensive half — a refused id costs nothing, while a plausible one
 * costs four requests on the retry ladder before the API's 400 is believed.
 */
describe('isPlaylistId', () => {
  it('takes the three forms the API has answered for', () => {
    expect(isPlaylistId('PL0v718LJg-7_4Zwx3CE7kZ398mhlB2TqF')).toBe(true); // PL + 32
    expect(isPlaylistId('PL7590BF3B139A354D')).toBe(true); // PL + 16 hex
    expect(isPlaylistId('PLEd-FHe0va8k')).toBe(true); // PL + a video id
  });

  it('refuses the lengths in between, which is every id that ever 400d', () => {
    expect(isPlaylistId('PL0v718LJg-7_4Zwx3CE7kZ398mhlB2Tq')).toBe(false); // one short
    expect(isPlaylistId('PL0v718LJg-7_4Zwx3CE7kZ398mhlB2TqF473')).toBe(false); // junk glued on
    expect(isPlaylistId('PLIDybdspTAuzbl0QKj5uhC')).toBe(false); // a middle length
  });

  it('refuses the legacy form when it is not hex — a truncated modern id wears that length', () => {
    expect(isPlaylistId('PLOzRYVm0a65f298xo')).toBe(false);
  });

  it('refuses the prefixes that are never a course', () => {
    for (const id of [
      'UUEd-FHe0va8kAAAAAAAAAAAAAAAAAAAAA',
      'OLAK5uy_kAAAAAAAAAAAAAAAAAAAAAAAAA',
      'RDEd-FHe0va8k',
      'WL',
      'LL',
    ])
      expect(isPlaylistId(id)).toBe(false);
  });
});

describe('playlistIdsIn', () => {
  it('reads share links and watch-page links alike', () => {
    expect(
      playlistIdsIn(
        'course: https://www.youtube.com/playlist?list=PL7590BF3B139A354D and ' +
          'https://youtube.com/watch?v=abc&list=PL0v718LJg-7_4Zwx3CE7kZ398mhlB2TqF'
      )
    ).toEqual(['PL7590BF3B139A354D', 'PL0v718LJg-7_4Zwx3CE7kZ398mhlB2TqF']);
  });

  it('drops a link glued to the next word rather than truncating it', () => {
    expect(playlistIdsIn('see ?list=PL0v718LJg-7_4Zwx3CE7kZ398mhlB2TqF473')).toEqual([]);
  });

  it('does not read a modern id as its own first thirteen characters', () => {
    // The alternation is ordered, so `PL` + 11 placed first would match here
    // and the lookahead would then throw the whole id away.
    const id = 'PLaqpC4kq8GpwXXXXXXXXXXXXXXXXXXXXX';
    expect(id).toHaveLength(34);
    expect(playlistIdsIn(`?list=${id}`)).toEqual([id]);
  });

  it('deduplicates, because the same course is linked twice in every reading list', () => {
    const twice = '?list=PL7590BF3B139A354D and again ?list=PL7590BF3B139A354D';
    expect(playlistIdsIn(twice)).toEqual(['PL7590BF3B139A354D']);
  });
});
