import { useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { LEARN_PATH } from '@/lib/entry';
import { useUi } from '@/store/ui';
import { usePlace, type Place } from './PlaceNav';
import { Switch, type SwitchOption } from './ui';

/**
 * The two places of the site, said once on a wide window — the same pair the
 * bar at the foot of a phone spells out.
 *
 * A switch like this was tried on the desktop before and taken out, and the
 * objection is worth keeping: it stood in the right-hand corner beside the
 * map/list switch and the language plate, three near-identical pills a reader
 * had to spell out. The answer was never "no switch" but "not that corner".
 * Here it stands at the other end of the header, beside the wordmark, where
 * site-level navigation belongs — the right corner keeps the controls about
 * the current screen, and the two ends stop competing.
 *
 * Only on the two top-level screens, exactly like the phone's bar: inside a
 * field the way back is the arrow in the header, and a pair of places over a
 * course panel is a second navigation arguing with the first.
 */
export default function PlaceTabs({ className = '' }: { className?: string }) {
  const { t } = useT();
  const navigate = useNavigate();
  const place = usePlace();
  const closeProfile = useUi((state) => state.closeProfile);

  const options: Array<SwitchOption<Place>> = [
    { value: 'learn', label: t('ui.nav.learn'), icon: 'play' },
    { value: 'catalog', label: t('ui.nav.catalog'), icon: 'map' },
  ];

  return (
    <Switch
      value={place}
      options={options}
      onChange={(next) => {
        // Going somewhere closes the drawer on the way, as the phone's bar
        // does: a press that navigated under an open modal would be a door
        // that leads into the same room.
        closeProfile();
        navigate(next === 'learn' ? LEARN_PATH : '/');
      }}
      label={t('ui.nav.places')}
      className={className}
    />
  );
}
