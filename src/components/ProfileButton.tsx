import { useT } from '@/i18n';
import { useUi } from '@/store/ui';
import Icon from './Icon';

/**
 * The way into the profile panel, identical on both screens.
 *
 * The label is optional because the courses screen has a header full of filters
 * and no room for a word that the avatar already carries; where there is room,
 * the word stays — an unlabelled disc in a corner is a guess.
 */
export default function ProfileButton({
  label = false,
  className = '',
}: {
  label?: boolean;
  className?: string;
}) {
  const { t } = useT();
  const openProfile = useUi((state) => state.openProfile);

  return (
    <button
      type="button"
      className={`profile-btn ${label ? 'pr-3' : ''} ${className}`}
      onClick={openProfile}
      aria-label={t('ui.nav.profile')}
    >
      <span className="profile-disc">
        <Icon name="profile" size={14} />
      </span>
      {label ? <span className="hidden sm:inline">{t('ui.nav.profile')}</span> : null}
    </button>
  );
}
