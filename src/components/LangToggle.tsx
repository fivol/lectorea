import { UI_LANGS } from '@shared/schema';
import { useT } from '@/i18n';
import { useProfile } from '@/store/profile';

/**
 * Russian and English, one click away in the header.
 *
 * Beside the theme switch rather than inside the profile modal, and for the
 * same reason: someone who cannot read the interface cannot find the settings
 * that would fix it. Two letters in the corner are what that person looks for,
 * and they are the one control on the page that has to work before the page
 * can be read.
 *
 * With two languages this is a switch, not a menu, so it follows the theme
 * button's rule: what it shows is where the click leads, not where you are.
 * The page behind it is already in the other language and says so louder than
 * any label could.
 */
export default function LangToggle({ className = '' }: { className?: string }) {
  const { t, lang } = useT();
  const setSetting = useProfile((state) => state.setSetting);

  const index = Math.max(
    UI_LANGS.findIndex((entry) => entry.id === lang),
    0
  );
  const next = UI_LANGS[(index + 1) % UI_LANGS.length];
  const label = t(`ui.lang.switchTo.${next.id}`);

  return (
    <button
      type="button"
      className={`lang-btn tap ${className}`}
      lang={next.id}
      aria-label={label}
      title={label}
      onClick={() => setSetting('lang', next.id)}
    >
      {/* The same slot the theme glyph swaps in, so the two controls beside
          each other change in the same way. */}
      <span className="swap swap-wide">
        {UI_LANGS.map((entry) => (
          <span key={entry.id} data-on={entry.id === next.id}>
            {entry.short}
          </span>
        ))}
      </span>
    </button>
  );
}
