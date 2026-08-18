import { UI_LANGS } from '@shared/schema';
import { useT } from '@/i18n';
import { useLocation } from 'react-router-dom';
import { useProfile } from '@/store/profile';
import { hrefInLang } from '@/lib/lang';

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
  const location = useLocation();

  const index = Math.max(
    UI_LANGS.findIndex((entry) => entry.id === lang),
    0
  );
  const next = UI_LANGS[(index + 1) % UI_LANGS.length];
  const label = t(`ui.lang.switchTo.${next.id}`);

  /*
   * The same page in the other language, as an address — `/courses/calculus-1`
   * and `/en/courses/calculus-1` are two pages, and this is the link between
   * them that `hreflang` also names. `location` comes from the router, so it is
   * already stripped of the base and of the language segment; `hrefInLang` puts
   * back the ones the other tree needs.
   *
   * A real link rather than a button: the switch is one of the two things on
   * the page that has to work for somebody who cannot read it, and a link can
   * be opened in a new tab, copied, and followed by a crawler that would
   * otherwise never learn the English tree exists.
   */
  const href = hrefInLang(`${location.pathname}${location.search}`, next.id);

  return (
    <a
      className={`lang-btn ${className}`}
      href={href}
      lang={next.id}
      hrefLang={next.id}
      aria-label={label}
      title={label}
      // The whole document, not a route change: the router's basename is fixed
      // when it mounts, and so is the dictionary the page was rendered from.
      // A language is changed rarely enough that one load is the honest way to
      // do it, and it lands on the page search already has in that language.
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
    </a>
  );
}
