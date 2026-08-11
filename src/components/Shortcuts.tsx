import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { useEscape, useFocusTrap, useMediaQuery, useScrollLock } from '@/lib/hooks';
import { resolveTheme, useProfile } from '@/store/profile';
import { useUi } from '@/store/ui';
import { IconButton, Kbd } from './ui';

/** Every shortcut in one list, so the handler and the help cannot drift apart. */
const KEYS = ['slash', 't', 'm', 'question', 'escape'] as const;

/**
 * The keyboard, for people who use one.
 *
 * Single letters, no modifiers — this is a reading tool, not an editor, and
 * nothing here is destructive. They are ignored the moment anything is being
 * typed into, which is the only way a bare `t` can be safe.
 *
 * `?` lists them. A set of shortcuts nobody can discover is a set of shortcuts
 * nobody has.
 */
export default function Shortcuts() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useT();

  const theme = useProfile((state) => state.profile.settings.theme);
  const setSetting = useProfile((state) => state.setSetting);
  const prefersLight = useMediaQuery('(prefers-color-scheme: light)');
  const profileOpen = useUi((state) => state.profileOpen);

  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

      // A modal owns the keyboard while it is up; only `?` and Escape reach past it.
      const layered = profileOpen || helpOpen;

      if (event.key === '?') {
        event.preventDefault();
        setHelpOpen((value) => !value);
        return;
      }
      if (layered) return;

      if (event.key === 't' || event.key === 'е') {
        event.preventDefault();
        setSetting('theme', resolveTheme(theme, prefersLight) === 'dark' ? 'light' : 'dark');
      }
      if (event.key === 'm' || event.key === 'ь') {
        event.preventDefault();
        navigate(location.pathname === '/' ? '/courses' : '/');
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, location.pathname, theme, prefersLight, setSetting, profileOpen, helpOpen]);

  if (!helpOpen) return null;
  return <HelpSheet onClose={() => setHelpOpen(false)} label={t('ui.shortcuts.title')} />;
}

function HelpSheet({ onClose, label }: { onClose: () => void; label: string }) {
  const { t } = useT();
  useEscape(true, onClose);
  useScrollLock(true);
  const trapRef = useFocusTrap(true);

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-6">
      <div
        className="fade-only absolute inset-0 animate-fade-in bg-overlay"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* `max-h-full` is against the padded box around it, so the sheet stays on
          screen — and scrolls rather than spilling — in a short window. */}
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="panel-scroll relative max-h-full w-[min(420px,92vw)] animate-scale-in
                   rounded-pop border border-line bg-surface p-5 shadow-[var(--shadow-modal)]"
      >
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-h3">{label}</h2>
          <IconButton
            icon="close"
            iconSize={14}
            label={t('ui.common.close')}
            className="ml-auto"
            onClick={onClose}
          />
        </div>
        <dl className="space-y-2">
          {KEYS.map((key) => (
            <div key={key} className="flex items-baseline gap-3">
              <dt className="w-16 shrink-0">
                <Kbd className="num py-0.5">{t(`ui.shortcuts.key.${key}`)}</Kbd>
              </dt>
              <dd className="min-w-0 flex-1 text-caption text-ink-dim">
                {t(`ui.shortcuts.${key}`)}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
