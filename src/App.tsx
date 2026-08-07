import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { CatalogProvider } from '@/lib/catalog';
import { applyTheme, useProfile } from '@/store/profile';
import MapScreen from '@/screens/Map/MapScreen';
import GraphScreen from '@/screens/Graph/GraphScreen';
import ProfilePanel from '@/screens/Profile/ProfilePanel';
import VersionBanner from '@/components/VersionBanner';

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
        <Route path="/courses" element={<GraphScreen />} />
        <Route path="/courses/:courseId" element={<GraphScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <ProfilePanel />
    </CatalogProvider>
  );
}
