import { useT } from '@/i18n';
import { SYNC_AVAILABLE } from '@/store/sync';
import Icon from '@/components/Icon';
import SyncSection from './SyncSection';

/**
 * The account, first in the drawer and first on the screen.
 *
 * It used to be a section halfway down the tab called «Данные», under the
 * heading about exporting a file — which is the last place a reader looks for
 * a sign-in, and exactly the reader who needs it most: somebody sitting at a
 * second device, wanting last night's progress on it. Two devices is the whole
 * reason this exists, and the thing it answered was three presses and a
 * scroll deep.
 *
 * The file did not move. It is still the answer that needs nobody's server, on
 * the tab it has always been on — this is only the two of them told apart, so
 * that the question «как открыть то же самое на телефоне» has an answer with
 * its own name on it.
 *
 * A build with no Firebase project shows the reason rather than an empty tab:
 * that is a fork or a `pnpm dev`, and in both the catalogue is complete
 * without it — see docs/sync.md.
 */
export default function AccountTab() {
  const { t } = useT();

  return (
    <div className="max-w-lg space-y-6 p-4">
      {/* The section says everything, including the sentence about signing in
          unlocking nothing — a second copy of it above the heading was the
          same promise made twice on one screen. */}
      {SYNC_AVAILABLE ? (
        <SyncSection />
      ) : (
        <p className="flex items-start gap-2 text-xs text-ink-faint">
          <Icon name="cloud-off" size={13} className="mt-0.5 shrink-0" />
          {t('ui.sync.unavailable')}
        </p>
      )}
    </div>
  );
}
