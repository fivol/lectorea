import { useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { LEARN_PATH } from '@/lib/entry';
import { useSync } from '@/store/sync';
import Icon from './Icon';

/**
 * The way to the desk from inside the catalogue.
 *
 * It used to wear the anonymous-person glyph and the word «Профиль», which is
 * the word the settings drawer also answered to — one name on two doors, and a
 * person-glyph that reads as "account" leading to a page of study. The disc now
 * carries the play glyph the «Обучение» tab wears at the foot of a phone, and
 * the label says where the press leads: «Моё обучение». On the top-level
 * screens the same journey is a tab beside the wordmark — see `PlaceTabs` —
 * and this button remains for the screens deep inside a field, whose header
 * has no room for a pair of tabs.
 *
 * The label is optional because the courses screen has a header full of filters
 * and no room for the words the disc's `aria-label` still carries.
 *
 * Signed in, the disc carries the account's initial instead of the glyph. That
 * is the whole of what syncing shows outside its own section, and it is
 * enough: the one thing worth knowing at a glance is *whose* progress this is,
 * which matters on a shared machine and nowhere else.
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
      aria-label={t('ui.nav.myLearning')}
    >
      <span className="profile-disc">
        {initial ? (
          <span className="font-display text-[13px] leading-none">{initial}</span>
        ) : (
          <Icon name="play" size={12} />
        )}
      </span>
      {label ? <span className="hidden sm:inline">{t('ui.nav.myLearning')}</span> : null}
    </button>
  );
}
