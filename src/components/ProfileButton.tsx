import { useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { LEARN_PATH } from '@/lib/entry';
import { useSync } from '@/store/sync';
import Icon from './Icon';

/**
 * The way to the desk, identical on every screen that is not it.
 *
 * It used to open the profile modal, and the modal used to hold everything a
 * reader had studied. That moved to a page, and this moved with it: the disc
 * is the one door to «моё», and the settings are a layer opened from the desk
 * rather than a second thing hiding behind the same glyph. What it saves is a
 * pill: the alternative was a two-word switch in the header next to the
 * map/list switch and the language plate, three near-identical shapes in one
 * corner.
 *
 * The label is optional because the courses screen has a header full of filters
 * and no room for a word that the avatar already carries; where there is room,
 * the word stays — an unlabelled disc in a corner is a guess.
 *
 * Signed in, the disc carries the account's initial instead of the anonymous
 * glyph. That is the whole of what syncing shows outside its own section, and
 * it is enough: the one thing worth knowing at a glance is *whose* progress
 * this is, which matters on a shared machine and nowhere else.
 */
export default function ProfileButton({
  label = false,
  className = '',
}: {
  label?: boolean;
  className?: string;
}) {
  const { t } = useT();
  const navigate = useNavigate();
  const account = useSync((state) => state.account);
  const initial = (account?.name || account?.email || '').trim().slice(0, 1).toUpperCase();

  return (
    <button
      type="button"
      className={`profile-btn ${label ? 'pr-3' : ''} ${className}`}
      onClick={() => navigate(LEARN_PATH)}
      aria-label={t('ui.nav.profile')}
    >
      <span className="profile-disc">
        {initial ? (
          <span className="font-display text-[13px] leading-none">{initial}</span>
        ) : (
          <Icon name="profile" size={14} />
        )}
      </span>
      {label ? <span className="hidden sm:inline">{t('ui.nav.profile')}</span> : null}
    </button>
  );
}
