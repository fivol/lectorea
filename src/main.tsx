import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { initAnalytics, setAnalyticsConsent } from '@/lib/analytics';
import { useProfile } from '@/store/profile';
import './index.css';

/*
 * The reader's answer about being counted, before anything is counted.
 *
 * Here rather than inside the analytics module because the dependency has to
 * run this way round: the store reports its own writes through `track`, so the
 * module must know nothing about the store, and the setting is pushed to it
 * instead. Read once at boot from the profile that is already in memory, and
 * followed afterwards, so the switch in the settings takes effect on the press.
 */
initAnalytics(useProfile.getState().profile.settings.analytics);
useProfile.subscribe((state, previous) => {
  const now = state.profile.settings.analytics;
  if (now !== previous.profile.settings.analytics) setAnalyticsConsent(now);
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* Opt in to the v7 behaviours now, so the console stays free of warnings
        and the upgrade is not a separate piece of work later. */}
    {/* The site is served from a subdirectory on GitHub Pages; BASE_URL is
        '/' in dev and the subdirectory in a build, so routes stay relative
        to wherever the app is mounted. */}
    <BrowserRouter
      basename={import.meta.env.BASE_URL}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
