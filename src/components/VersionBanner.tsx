import { useT } from '@/i18n';
import { useProfile } from '@/store/profile';
import Icon from './Icon';

/**
 * Shown when localStorage holds a profile written by a newer build. The profile
 * is left untouched — a lossy migration would quietly destroy someone's marks.
 */
export default function VersionBanner() {
  const locked = useProfile((state) => state.locked);
  const { t } = useT();
  if (!locked) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-danger/90
                 px-4 py-2 text-center text-sm text-canvas"
    >
      <Icon name="warning" />
      {t('ui.profile.versionBanner')}
    </div>
  );
}
