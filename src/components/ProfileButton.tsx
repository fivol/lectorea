import { useT } from '@/i18n';
import { useSync } from '@/store/sync';
import { useUi } from '@/store/ui';
import Icon from './Icon';

/**
 * The way into the profile panel, identical on both screens.
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
  const openProfile = useUi((state) => state.openProfile);
  const account = useSync((state) => state.account);
  const initial = (account?.name || account?.email || '').trim().slice(0, 1).toUpperCase();

  return (
    <button
      type="button"
      className={`profile-btn ${label ? 'pr-3' : ''} ${className}`}
      onClick={() => openProfile()}
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
