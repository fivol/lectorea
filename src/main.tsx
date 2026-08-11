import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

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
