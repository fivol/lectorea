import { migrateProfile, ProfileSchema, type Profile } from '@shared/schema';
import { todayStamp } from './format';

/** Export and import of the profile file. */

export function downloadProfile(profile: Profile): void {
  const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `profile-${todayStamp()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export type ImportPreview = {
  profile: Profile;
  courses: number;
  playlists: number;
  /** Lectures with a mark of their own — a sealed playlist writes none. */
  videos: number;
  updatedAt: string;
};

/**
 * A profile file, whatever version wrote it.
 *
 * An export taken before lectures were tracked is still a profile, and refusing
 * it because the number at the top says 1 would make the export button a trap
 * for anybody who used it once and came back later.
 */
export function parseProfile(text: string): ImportPreview | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = ProfileSchema.safeParse(migrateProfile(raw));
  if (!parsed.success) return null;

  return {
    profile: parsed.data,
    courses: Object.keys(parsed.data.courses).length,
    playlists: Object.keys(parsed.data.playlists).length,
    videos: Object.values(parsed.data.videos).filter((mark) => mark.done).length,
    updatedAt: parsed.data.updatedAt,
  };
}
