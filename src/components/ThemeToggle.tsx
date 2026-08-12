import { useT } from '@/i18n';
import { useMediaQuery } from '@/lib/hooks';
import { resolveTheme, useProfile } from '@/store/profile';
import Icon from './Icon';
import { IconButton } from './ui';

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
    /* No `tap`: it shares a plate with the language and the profile, and one
       control growing to 44 inside it is what made the corner of the header a
       head taller than the row it sits in. Under a finger the whole plate is
       40 and the plate is what you aim at. */
    <IconButton label={label} className={className} onClick={() => setSetting('theme', next)}>
      {/* The glyph is the destination, not the current state — it is what the
          label says, so the two cannot be read against each other. Both are
          mounted and one is turned out of the slot, so the change of theme is
          also a small change of weather in the corner of the screen. */}
      <span className="swap">
        <span data-on={next === 'dark'} className="text-formal">
          <Icon name="moon" size={17} />
        </span>
        <span data-on={next === 'light'} className="text-warning">
          <Icon name="sun" size={17} />
        </span>
      </span>
    </IconButton>
  );
}
