import { useLocation, useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { useIsMobile } from '@/lib/hooks';
import { LEARN_PATH } from '@/lib/entry';
import { useUi } from '@/store/ui';
import FloatingFoot from './FloatingFoot';
import Icon from './Icon';

/**
 * The two places this site has, and the one control that says which one you
 * are in.
 *
 * There is a catalogue — thirty-nine fields drawn as a map or listed as cards —
 * and there is a desk, where what a reader has actually studied lives. They
 * answer different questions and used to share one address, with the desk
 * folded into a plate in the corner and, on a phone, into a bar forty pixels
 * tall.
 *
 * On a phone the switch between them is this bar. On a wide window the same
 * pair stands beside the wordmark on the two top-level screens — see
 * `PlaceTabs`, and the history of the corner it deliberately avoids — while
 * the screens deep inside a field keep the disc in the corner as the one-press
 * way back to the desk.
 */

export type Place = 'learn' | 'catalog';

/** Which place the address is in. Everything that is not the desk is catalogue. */
export function usePlace(): Place {
  const { pathname } = useLocation();
  return pathname === LEARN_PATH || pathname.startsWith(`${LEARN_PATH}/`) ? 'learn' : 'catalog';
}

/** The two addresses the bar appears over — the top of each place. */
const TOP_LEVEL = ['/', LEARN_PATH];

/**
 * The phone's navigation: two destinations along the bottom of the window.
 *
 * Fixed to the window and rendered by the app rather than by a screen, for two
 * reasons a screen-level version got wrong. It **moved between the tabs** — the
 * desk carries a contribute line under its scroller and the map does not, so
 * the bar sat forty-one pixels higher on one than on the other and jumped as a
 * reader crossed between them. And it **disappeared under the settings sheet**,
 * which is exactly when somebody wants it: a modal is a layer over a screen,
 * not a reason to lose the way out of it.
 *
 * It is the only thing floating over the foot of these screens. The map used to
 * stack four: the zoom controls, the resume bar, the map/list switch and the
 * contribute line, in a band a thumb covers entirely.
 */
export default function BottomNav() {
  const { t } = useT();
  const navigate = useNavigate();
  const place = usePlace();
  const isMobile = useIsMobile();
  const { pathname } = useLocation();
  const closeProfile = useUi((state) => state.closeProfile);

  // Only over the top of each place. Inside a field — the columns, a course, a
  // recording — the way back is the arrow in the header, and a bar of places
  // over a course sheet is a second navigation arguing with the first.
  if (!isMobile || !TOP_LEVEL.includes(pathname)) return null;

  return (
    <FloatingFoot fixed>
      <nav
        aria-label={t('ui.nav.places')}
        className="plate pointer-events-auto flex items-center gap-1 p-1
                   shadow-[var(--shadow-pop)]"
      >
        {/* Going somewhere closes the drawer on the way. The bar is drawn over
            the settings sheet precisely so it can be pressed from inside it,
            and a press that navigated *under* an open modal would be a door
            that leads into the same room. */}
        <Tab
          icon="play"
          label={t('ui.nav.learn')}
          active={place === 'learn'}
          onClick={() => {
            closeProfile();
            navigate(LEARN_PATH);
          }}
        />
        <Tab
          icon="map"
          label={t('ui.nav.catalog')}
          active={place === 'catalog'}
          onClick={() => {
            closeProfile();
            navigate('/');
          }}
        />
      </nav>
    </FloatingFoot>
  );
}

function Tab({
  icon,
  label,
  active,
  onClick,
}: {
  icon: 'play' | 'map';
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      /* The label is written out rather than hidden under the glyph: two icons
         alone at the foot of a phone is a guess, and the bar has the width. */
      className={`mono-label flex min-w-[5.5rem] flex-col items-center gap-0.5 rounded-full
                  px-4 py-1.5 transition-colors duration-fast ease-out
                  ${active ? 'bg-accent-soft text-accent' : 'text-ink-dim hover:text-ink'}`}
    >
      <Icon name={icon} size={16} />
      {label}
    </button>
  );
}
