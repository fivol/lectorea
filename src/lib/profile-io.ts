import { ProfileSchema, type Profile } from '@shared/schema';
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
  updatedAt: string;
};

export function parseProfile(text: string): ImportPreview | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = ProfileSchema.safeParse(raw);
  if (!parsed.success) return null;

  return {
    profile: parsed.data,
    courses: Object.keys(parsed.data.courses).length,
    playlists: Object.keys(parsed.data.playlists).length,
    updatedAt: parsed.data.updatedAt,
  };
}
