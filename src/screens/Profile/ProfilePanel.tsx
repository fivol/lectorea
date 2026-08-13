import { useState } from 'react';
import { useT } from '@/i18n';
import { useEscape, useFocusTrap, useScrollLock } from '@/lib/hooks';
import { useUi } from '@/store/ui';
import { IconButton, Segmented } from '@/components/ui';
import LearningTab from './LearningTab';
import SettingsTab from './SettingsTab';
import DataTab from './DataTab';

const TABS = ['learning', 'settings', 'data'] as const;
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
  const [tab, setTab] = useState<Tab>('learning');

  useEscape(open, close);
  useScrollLock(open);
  const trapRef = useFocusTrap(open);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 md:flex md:items-center md:justify-center md:p-6">
      <div
        className="fade-only absolute inset-0 animate-fade-in bg-overlay"
        onClick={close}
        aria-hidden="true"
      />

      {/*
        A sheet on a phone, a centred modal above it — a media query rather than
        a measured viewport, so the first frame is already the right shape.

        Height follows the content. A profile holding one goal used to be a
        card at the top of a window-tall white rectangle, which reads as a page
        that failed to load rather than as a profile with one thing in it. The
        floor keeps the tab strip from looking cut off; the ceiling keeps a long
        list scrolling inside the modal rather than off the screen — and both
        are held under `100%` of the padded box, because a ceiling stated in
        viewport units plus the padding around it adds up to more than the
        window on a short one.
      */}
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('ui.profile.title')}
        tabIndex={-1}
        className="absolute inset-0 flex animate-slide-in-bottom flex-col overflow-hidden
                   bg-surface shadow-[var(--shadow-modal)]
                   md:relative md:inset-auto md:max-h-[min(88svh,100%)]
                   md:min-h-[min(20rem,100%)] md:w-[min(70rem,92vw)] md:animate-scale-in
                   md:rounded-pop md:border md:border-line"
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-3">
          <h2 className="font-display text-lg">{t('ui.profile.title')}</h2>
          <IconButton
            icon="close"
            label={t('ui.a11y.closePanel')}
            className="ml-auto"
            onClick={close}
          />
        </header>

        {/* One plate holding all three, as in the header: an underlined word is
            the tab bar of a document, and this is a control panel.

            Three and not five: what somebody has studied used to be split
            across «мои курсы», «мои плейлисты» and «недавние», which asked the
            reader to know which shape their own studying had before they could
            find it. It is one shelf-lined room now, and the other two tabs are
            what they always were — the settings, and the file. */}
        <nav className="shrink-0 border-b border-line px-4 py-3">
          <Segmented
            kind="tabs"
            value={tab}
            onChange={setTab}
            options={TABS.map((item) => ({ value: item, label: t(`ui.profile.tab.${item}`) }))}
          />
        </nav>

        <div className="panel-scroll min-h-0 flex-1" role="tabpanel">
          {tab === 'learning' ? <LearningTab /> : null}
          {tab === 'settings' ? <SettingsTab /> : null}
          {tab === 'data' ? <DataTab /> : null}
        </div>
      </div>
    </div>
  );
}
