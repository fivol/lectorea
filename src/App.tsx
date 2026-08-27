import { useEffect, useMemo } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { CatalogProvider } from '@/lib/catalog';
import { hasStudyHistory, isArrival, LEARN_PATH } from '@/lib/entry';
import { applyTheme, useProfile } from '@/store/profile';
import MapScreen from '@/screens/Map/MapScreen';
import CoursesScreen from '@/screens/Courses/CoursesScreen';
import LearnScreen from '@/screens/Learn/LearnScreen';
import ProfilePanel from '@/screens/Profile/ProfilePanel';
import BottomNav from '@/components/PlaceNav';
import VersionBanner from '@/components/VersionBanner';
import Shortcuts from '@/components/Shortcuts';

export default function App() {
  const theme = useProfile((state) => state.profile.settings.theme);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== 'auto') return;
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = (): void => applyTheme('auto');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  return (
    <CatalogProvider>
      <VersionBanner />
      <Routes>
        <Route path="/" element={<FrontDoor />} />
        {/*
          The desk. Everything on it comes out of the reader's own browser, so
          it is a page in the app and nothing in the sitemap — see
          `screens/Learn/LearnScreen`.
        */}
        <Route path={LEARN_PATH} element={<LearnScreen />} />
        <Route path="/courses" element={<CoursesScreen />} />
        <Route path="/courses/:courseId" element={<CoursesScreen />} />
        {/*
          One field of knowledge, as a place of its own. The same screen as
          `/courses?domain=…` and deliberately so — what it buys is an address a
          static host can serve a page for, which is the only way thirty-nine
          fields are thirty-nine pages to a crawler rather than one file with a
          query string on it. See `useCatalogParams` and `scripts/prerender.ts`.
        */}
        <Route path="/fields/:domainId" element={<CoursesScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {/* The navigation belongs to the app, not to a screen: fixed to the
          window, in the same place on both tabs, and above the settings sheet
          rather than under it. It draws nothing where it does not belong — see
          `BottomNav`. */}
      <BottomNav />
      <ProfilePanel />
      <Shortcuts />
    </CatalogProvider>
  );
}

/**
 * Which of the two front doors this visit opens on.
 *
 * The map for a stranger — it is what the site is, and it is what a crawler
 * and a shared link land on. The desk for somebody who has studied here, whose
 * question on arrival is "where was I" and who used to be handed thirty-nine
 * fields with the answer folded into a bar at the foot of them.
 *
 * Decided during the render rather than corrected in an effect: the profile is
 * read from `localStorage` when the store is created, so the answer is already
 * in memory and nothing has to flash the map first. `replace` because the
 * front page is not a step in the reader's history — pressing back from the
 * desk should leave the site, not bounce off a redirect.
 *
 * On the load's first look at `/` and never again, which is what keeps the
 * wordmark working: it leads home, home is the map, and a rule reading "a
 * reader with history never sees the front page" would take that door away.
 */
function FrontDoor() {
  const { key } = useLocation();
  // Read off the store rather than through the hook: this is a decision about
  // the visit, not a value the screen re-renders on. Marking a lecture done
  // while the map is open must not slide the reader sideways into the desk.
  const toDesk = useMemo(
    () => isArrival(key) && hasStudyHistory(useProfile.getState().profile),
    [key]
  );

  if (toDesk) return <Navigate to={LEARN_PATH} replace />;
  return <MapScreen />;
}
