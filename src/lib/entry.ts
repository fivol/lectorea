import type { Profile } from '@shared/schema';
import { useProfile } from '@/store/profile';

/**
 * Which of the two front doors a visit opens on.
 *
 * The catalogue answers "what is there" and the desk answers "where was I", and
 * those are two different readers arriving at the same address. A stranger
 * wants the map — it is the whole argument of the site, and it is what a
 * crawler and a shared link land on. Somebody who watched a lecture last night
 * wants the lecture, and used to be handed a drawing of thirty-nine fields with
 * the answer folded into a bar at the foot of it.
 *
 * So the address is the same and the screen is not: `/` renders the map for a
 * profile with nothing in it and sends the rest to `/learn`. The profile is
 * already in memory before the first render — it is read from `localStorage`
 * synchronously when the store is created — so the choice costs nothing and
 * nothing flashes.
 */

/**
 * The desk's address, in one place — it is written into the router, the
 * navigation, three presses on the map's card and the redirect below.
 */
export const LEARN_PATH = '/learn';

/**
 * Whether this reader has a past here worth opening the desk on.
 *
 * Cheaper than `useHighlights().any`, which the card on the map uses: that one
 * needs the catalogue in hand to tell a finished course from a course that has
 * since left the catalogue, and the entry decision is made before anything is
 * loaded.
 *
 * A *mark*, not an opening. Merely looking at a playlist writes `recent` and
 * `lastVideoId`, and for a while either counted as a past — so one curious
 * click on the first visit traded the map for a nearly empty desk, with
 * «Продолжить» offering the thing the reader had already decided against.
 * What counts is what the reader did on purpose: a lecture ticked or begun, a
 * course or recording marked, a day on the record.
 */
export function hasStudyHistory(profile: Profile): boolean {
  for (const mark of Object.values(profile.videos)) if (mark.done || mark.sec) return true;
  for (const entry of Object.values(profile.courses)) {
    if (entry.status || entry.favorite) return true;
  }
  for (const entry of Object.values(profile.playlists)) {
    if (entry.watched || entry.favorite) return true;
  }
  for (const day of profile.days) if (day.sec || day.lectures) return true;
  return false;
}

/** The same question, for anything rendering rather than routing. */
export function useStudyHistory(): boolean {
  return useProfile((state) => hasStudyHistory(state.profile));
}

/**
 * Whether this location is the one the browser arrived on, rather than one the
 * app navigated to.
 *
 * The redirect has to fire on arrival and never again: the wordmark leads home,
 * home is the map, and a rule reading "a reader with history never sees the
 * front page" would take that door away — press it, and the desk it just came
 * from would appear again.
 *
 * Read off the router's own key rather than kept as a flag somebody has to
 * claim. React Router stamps the first entry of a session `default` and gives
 * every later one a key of its own, which is exactly the distinction wanted —
 * and, being a fact about the location instead of a piece of module state, it
 * survives the double render `StrictMode` performs. A "claim once" flag does
 * not: the first render takes it, the second sees it gone, and React keeps the
 * second answer.
 */
export function isArrival(key: string): boolean {
  return key === 'default';
}
