import { useT } from '@/i18n';
import { useMediaQuery } from '@/lib/hooks';
import { resolveTheme, useProfile } from '@/store/profile';
import Icon from './Icon';

/**
 * Light and dark, one click away on both screens.
 *
 * The choice is about the room someone is sitting in, not about their account,
 * so making them open the profile modal to change it means most people put up
 * with the wrong one instead.
 *
 * The button never lands on «Авто»: that stays in the settings, where it is a
 * deliberate answer rather than a third stop in a cycle nobody wants to click
 * through. Under «Авто» the first click flips away from whatever the system
 * resolved to, which is the only reason anyone reaches for this button.
 */
export default function ThemeToggle({ className = '' }: { className?: string }) {
  const { t } = useT();
  const theme = useProfile((state) => state.profile.settings.theme);
  const setSetting = useProfile((state) => state.setSetting);
  const prefersLight = useMediaQuery('(prefers-color-scheme: light)');

  const next = resolveTheme(theme, prefersLight) === 'dark' ? 'light' : 'dark';
  const label = next === 'dark' ? t('ui.theme.toDark') : t('ui.theme.toLight');

  return (
    <button
      type="button"
      className={`btn px-2 ${className}`}
      onClick={() => setSetting('theme', next)}
      aria-label={label}
      title={label}
    >
      {/* The glyph is the destination, not the current state — it is what the
          label says, so the two cannot be read against each other. */}
      <Icon name={next === 'dark' ? 'moon' : 'sun'} />
    </button>
  );
}
