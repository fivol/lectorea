import { useState } from 'react';
import { useT } from '@/i18n';
import { useEscape, useFocusTrap, useIsMobile, useScrollLock } from '@/lib/hooks';
import { useUi } from '@/store/ui';
import Icon from '@/components/Icon';
import CoursesTab from './CoursesTab';
import PlaylistsTab from './PlaylistsTab';
import SettingsTab from './SettingsTab';
import DataTab from './DataTab';
import RecentTab from './RecentTab';

const TABS = ['courses', 'playlists', 'recent', 'settings', 'data'] as const;
type Tab = (typeof TABS)[number];

/**
 * A centred modal, not a sidebar: the profile is read in one sitting and closed,
 * so it should sit in the middle of attention rather than push the catalogue
 * sideways. Wide, because a grid of saved playlists does not fit in a rail.
 * Not URL state either — it is a modal layer, not a place.
 */
export default function ProfilePanel() {
  const open = useUi((state) => state.profileOpen);
  const close = useUi((state) => state.closeProfile);
  const { t } = useT();
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<Tab>('courses');

  useEscape(open, close);
  useScrollLock(open);
  const trapRef = useFocusTrap(open);

  if (!open) return null;

  return (
    <div className={`fixed inset-0 z-50 ${isMobile ? '' : 'flex items-center justify-center p-6'}`}>
      <div className="absolute inset-0 bg-black/50 animate-fade-in" onClick={close} aria-hidden="true" />

      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('ui.profile.title')}
        tabIndex={-1}
        className={`flex flex-col bg-surface shadow-[var(--shadow-panel)]
                    ${
                      isMobile
                        ? 'absolute inset-0 animate-slide-in-bottom'
                        : `relative h-[min(760px,88vh)] w-[min(1120px,92vw)] animate-scale-in
                           overflow-hidden rounded-2xl border border-line`
                    }`}
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
          <h2 className="font-display text-lg">{t('ui.profile.title')}</h2>
          <button
            type="button"
            className="btn-ghost ml-auto rounded p-1.5"
            onClick={close}
            aria-label={t('ui.a11y.closePanel')}
          >
            <Icon name="close" />
          </button>
        </header>

        <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-2" role="tablist">
          {TABS.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={tab === item}
              onClick={() => setTab(item)}
              className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors
                          ${
                            tab === item
                              ? 'border-accent text-ink'
                              : 'border-transparent text-ink-faint hover:text-ink-dim'
                          }`}
            >
              {t(`ui.profile.tab.${item}`)}
            </button>
          ))}
        </nav>

        <div className="panel-scroll min-h-0 flex-1" role="tabpanel">
          {tab === 'courses' ? <CoursesTab /> : null}
          {tab === 'playlists' ? <PlaylistsTab /> : null}
          {tab === 'recent' ? <RecentTab /> : null}
          {tab === 'settings' ? <SettingsTab /> : null}
          {tab === 'data' ? <DataTab /> : null}
        </div>
      </div>
    </div>
  );
}
