import { useEffect, useState } from 'react';
import { useT } from '@/i18n';
import { useEscape, useFocusTrap, useIsMobile, useScrollLock } from '@/lib/hooks';
import { useUi, type ProfileTab } from '@/store/ui';
import { IconButton, Segmented } from '@/components/ui';
import AccountTab from './AccountTab';
import SettingsTab from './SettingsTab';
import DataTab from './DataTab';

const TABS: ProfileTab[] = ['account', 'settings', 'data'];

/**
 * The drawer: the account the profile travels on, what the theme is, which
 * language, and the file it all goes out as.
 *
 * A modal and not a page, and now for a reason rather than by default. It used
 * to hold three tabs, and the first of them — everything a reader had studied —
 * was a *place*: something to link to, to come back to with a back button, to
 * open a home-screen icon on. None of that is what a modal can be, so studying
 * moved out to `/learn` and what is left here is the drawer it always was.
 * Opened over whatever was on screen, closed again, and the screen underneath
 * is still where it was.
 */
export default function ProfilePanel() {
  const open = useUi((state) => state.profileOpen);
  const close = useUi((state) => state.closeProfile);
  const opened = useUi((state) => state.profileTab);
  const { t } = useT();
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<ProfileTab>(opened);

  // The caller says which drawer it wants — «Синхронизация» from the desk opens
  // on the file rather than on the theme switch. Followed on every opening, so
  // a second press with a different tab in it is not ignored because the first
  // one set the state.
  useEffect(() => {
    if (open) setTab(opened);
  }, [open, opened]);

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
                   md:min-h-[min(20rem,100%)] md:w-[min(52rem,92vw)] md:animate-scale-in
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
            the tab bar of a document, and this is a control panel. The account
            leads, because a reader opening this on their phone is almost
            always opening it for that one thing. */}
        <nav className="shrink-0 border-b border-line px-4 py-3">
          <Segmented
            kind="tabs"
            value={tab}
            onChange={setTab}
            options={TABS.map((item) => ({ value: item, label: t(`ui.profile.tab.${item}`) }))}
          />
        </nav>

        {/*
          The bar of places lies *on* the sheet rather than the sheet stopping
          short of it: a modal is a layer over a screen, not a reason to lose
          the way out of one, and a reader who opened the settings and wants the
          catalogue back should not have to find the × first. The sheet still
          reaches the bottom of the window — leaving a strip of dimmed page
          under it reads as a panel that failed to close — and what keeps the
          last row of content clear of the bar is this padding. `--foot` is what
          the bar publishes, and it is zero on every window that has none.
        */}
        <div
          className="panel-scroll min-h-0 flex-1"
          role="tabpanel"
          style={isMobile ? { paddingBottom: 'var(--foot, 0px)' } : undefined}
        >
          {tab === 'account' ? <AccountTab /> : null}
          {tab === 'settings' ? <SettingsTab /> : null}
          {tab === 'data' ? <DataTab /> : null}
        </div>
      </div>
    </div>
  );
}
