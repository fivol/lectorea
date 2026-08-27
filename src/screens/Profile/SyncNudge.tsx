import { useState } from 'react';
import { useT } from '@/i18n';
import { useProfile } from '@/store/profile';
import { SYNC_AVAILABLE, useSync } from '@/store/sync';
import Icon from '@/components/Icon';
import { Button, IconButton } from '@/components/ui';

/**
 * One line, once, for somebody who has something to lose.
 *
 * The account is a setting and must never become a wall, so this is the only
 * place on the whole site that mentions it unasked — and it is inside the
 * profile, under the numbers it is about, rather than anywhere a reader who
 * came to find a lecture would meet it.
 *
 * The condition is a habit rather than a click: three separate days with study
 * on them. One afternoon of marking things is not yet a year of work, and a
 * site that asks for an account before a reader has decided they are using it
 * is the thing this line exists not to be. It is dismissible, and the dismissal
 * belongs to this browser rather than to the profile — the profile of somebody
 * who signs in later will be read on machines that never saw this line.
 */
const DAYS_BEFORE_ASKING = 3;
const DISMISSED_KEY = 'catalog.sync.nudge';

function dismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

export default function SyncNudge({ onOpenData }: { onOpenData: () => void }) {
  const { t } = useT();
  const days = useProfile((state) => state.profile.days.length);
  const signedIn = useSync((state) => Boolean(state.account));
  const [hidden, setHidden] = useState(dismissed);

  if (!SYNC_AVAILABLE || signedIn || hidden || days < DAYS_BEFORE_ASKING) return null;

  const dismiss = (): void => {
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Then it comes back next visit, which is a nuisance and not a bug.
    }
    setHidden(true);
  };

  return (
    <div className="surface flex items-center gap-2 px-3 py-2">
      <Icon name="cloud-off" size={13} className="shrink-0 text-ink-faint" />
      <p className="text-xs text-ink-dim">{t('ui.sync.nudge')}</p>
      <Button variant="ghost" small className="ml-auto shrink-0" onClick={onOpenData}>
        {t('ui.sync.nudgeAction')}
      </Button>
      <IconButton icon="close" iconSize={13} label={t('ui.sync.nudgeDismiss')} onClick={dismiss} />
    </div>
  );
}
