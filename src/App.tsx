import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { CatalogProvider } from '@/lib/catalog';
import { applyTheme, useProfile } from '@/store/profile';
import MapScreen from '@/screens/Map/MapScreen';
import CoursesScreen from '@/screens/Courses/CoursesScreen';
import ProfilePanel from '@/screens/Profile/ProfilePanel';
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
        <Route path="/" element={<MapScreen />} />
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
      <ProfilePanel />
      <Shortcuts />
    </CatalogProvider>
  );
}
