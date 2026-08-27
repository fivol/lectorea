import { useLocation, useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { LEARN_PATH } from '@/lib/entry';
import { useUi } from '@/store/ui';
import Icon from './Icon';
import { Switch, type SwitchOption } from './ui';

/**
 * The two places this site has, and the one control that says which one you
 * are in.
 *
 * There is a catalogue — thirty-nine fields drawn as a map or listed as cards —
 * and there is a desk, where what a reader has actually studied lives. They
 * answer different questions and used to share one address, with the desk
 * folded into a plate in the corner of the catalogue and, on a phone, into a
 * bar forty pixels tall. A control that decides *which place you are in*
 * cannot be a badge on one of them.
 *
 * One component, two shapes: a switch in the header where there is a header to
 * put it in, and a bar along the foot of a phone, where the thumb is. Both are
 * the same statement — these are places, and you are in this one.
 */

export type Place = 'learn' | 'catalog';

/** Which place the address is in. Everything that is not the desk is catalogue. */
export function usePlace(): Place {
  const { pathname } = useLocation();
  return pathname === LEARN_PATH || pathname.startsWith(`${LEARN_PATH}/`) ? 'learn' : 'catalog';
}

/**
 * The header's flavour: two words on one plate, the same kit the map/list
 * switch is cut from, so a reader learns one control and reads both.
 */
export function PlaceSwitch({ className = '' }: { className?: string }) {
  const { t } = useT();
  const navigate = useNavigate();
  const place = usePlace();

  const options: Array<SwitchOption<Place>> = [
    { value: 'learn', label: t('ui.nav.learn'), icon: 'play' },
    { value: 'catalog', label: t('ui.nav.catalog'), icon: 'map' },
  ];

  return (
    <Switch
      value={place}
      options={options}
      onChange={(next) => navigate(next === 'learn' ? LEARN_PATH : '/')}
      label={t('ui.nav.places')}
      className={className}
    />
  );
}

/**
 * The phone's flavour: three destinations along the bottom of the window.
 *
 * Three and not two, because the third is what the corner of the header used to
 * be. A phone's header has room for the wordmark and about two glyphs, and the
 * two it has to keep are the ones about the room somebody is sitting in — the
 * theme and the language. So the profile — the account, the file, the settings
 * — comes down here with the places, and the avatar leaves the corner on
 * narrow windows only.
 *
 * It is the only thing floating over the foot of these screens. The map used
 * to stack four: the zoom controls, the resume bar, the map/list switch and
 * the contribute line, in a band a thumb covers entirely. Two of them are gone,
 * one moved up beside the search, and what is left is one bar that always says
 * the same thing in the same place.
 */
export default function BottomNav() {
  const { t } = useT();
  const navigate = useNavigate();
  const place = usePlace();
  const openProfile = useUi((state) => state.openProfile);
  const profileOpen = useUi((state) => state.profileOpen);

  return (
    <nav
      aria-label={t('ui.nav.places')}
      className="plate pointer-events-auto flex items-center gap-1 p-1
                 shadow-[var(--shadow-pop)]"
    >
      <Tab
        icon="play"
        label={t('ui.nav.learn')}
        active={place === 'learn' && !profileOpen}
        onClick={() => navigate(LEARN_PATH)}
      />
      <Tab
        icon="map"
        label={t('ui.nav.catalog')}
        active={place === 'catalog' && !profileOpen}
        onClick={() => navigate('/')}
      />
      <Tab
        icon="profile"
        label={t('ui.nav.profile')}
        active={profileOpen}
        onClick={() => openProfile()}
      />
    </nav>
  );
}

function Tab({
  icon,
  label,
  active,
  onClick,
}: {
  icon: 'play' | 'map' | 'profile';
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      /* The label is written out rather than hidden under the glyph: three
         icons alone in a corner of a phone is a guess, and the bar has the
         width for three short words. */
      className={`mono-label flex min-w-[4.75rem] flex-col items-center gap-0.5 rounded-full
                  px-3 py-1.5 transition-colors duration-fast ease-out
                  ${active ? 'bg-accent-soft text-accent' : 'text-ink-dim hover:text-ink'}`}
    >
      <Icon name={icon} size={16} />
      {label}
    </button>
  );
}
