import { useState } from 'react';
import { useT } from '@/i18n';
import { SYNC_AVAILABLE, useSync, type SyncStatus } from '@/store/sync';
import Icon from '@/components/Icon';
import { Button } from '@/components/ui';

/**
 * The account, where the profile's other homes are listed.
 *
 * It sits above the file rather than in a tab of its own, because it is the
 * same question the export button answers — where does this live besides here —
 * and splitting them would make somebody choose between two words before they
 * know what either does. Signing in is the easy answer; the file underneath it
 * is the one that needs nobody's server.
 *
 * A build with no Firebase project renders none of this. That is a fork, a
 * checkout and `pnpm dev`, and in all three the catalogue is complete without
 * it — see docs/sync.md.
 */
export default function SyncSection() {
  const { t } = useT();
  const status = useSync((state) => state.status);
  const account = useSync((state) => state.account);
  const fault = useSync((state) => state.fault);
  const busy = useSync((state) => state.busy);
  const signIn = useSync((state) => state.signIn);
  const signOut = useSync((state) => state.signOut);
  const forget = useSync((state) => state.forget);
  const [confirming, setConfirming] = useState(false);

  if (!SYNC_AVAILABLE) return null;
  const signedIn = Boolean(account);

  return (
    <section>
      <h3 className="text-sm font-medium">{t('ui.sync.title')}</h3>

      {signedIn ? (
        <>
          <div className="surface mt-2 flex items-center gap-3 p-3">
            {/* The same disc as the header's, carrying the first letter of the
                account instead of the anonymous glyph — so the corner of every
                screen answers "signed in as whom" without a word of chrome. */}
            <span className="profile-disc shrink-0 font-display text-sm">{initial(account)}</span>
            <div className="min-w-0">
              <p className="truncate text-sm">{account!.email ?? account!.name}</p>
              {/* One word, always. What went wrong is a sentence and a sentence
                  belongs under the card — inside it, the row grows to three
                  lines and the account stops being the thing being read. */}
              <p
                className={`mt-0.5 flex items-center gap-1.5 text-xs ${
                  status === 'error' ? 'text-danger' : 'text-ink-faint'
                }`}
              >
                <Icon
                  name={status === 'error' ? 'warning' : status === 'synced' ? 'check' : 'sync'}
                  size={11}
                  className={status === 'working' || status === 'connecting' ? 'animate-spin' : ''}
                />
                {t(`ui.sync.state.${state(status)}`)}
              </p>
            </div>
            <Button small className="ml-auto shrink-0" disabled={busy} onClick={signOut}>
              {t('ui.sync.signOut')}
            </Button>
          </div>

          {status === 'error' ? (
            <p className="mt-2 text-xs text-danger">{t(`ui.sync.error.${fault ?? 'unknown'}`)}</p>
          ) : null}

          <p className="mt-2 text-xs text-ink-faint">{t('ui.sync.onHint')}</p>

          {confirming ? (
            <div className="surface mt-3 border-danger/40 p-3">
              <p className="mb-3 text-sm text-ink-dim">{t('ui.sync.forgetConfirm')}</p>
              <div className="flex gap-2">
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={() => {
                    forget();
                    setConfirming(false);
                  }}
                >
                  {t('ui.sync.forgetDo')}
                </Button>
                <Button onClick={() => setConfirming(false)}>{t('ui.common.cancel')}</Button>
              </div>
            </div>
          ) : (
            <Button
              variant="ghost"
              small
              className="mt-2 text-danger"
              onClick={() => setConfirming(true)}
            >
              {t('ui.sync.forget')}
            </Button>
          )}
        </>
      ) : (
        <>
          <p className="mt-1 text-xs text-ink-faint">{t('ui.sync.offHint')}</p>
          <Button
            variant="primary"
            icon="google"
            className="mt-3"
            disabled={busy || status === 'connecting'}
            onClick={signIn}
          >
            {t('ui.sync.signIn')}
          </Button>
          {status === 'error' ? (
            <p className="mt-2 flex items-center gap-2 text-xs text-danger">
              <Icon name="warning" size={12} />
              {t(`ui.sync.error.${fault ?? 'unknown'}`)}
            </p>
          ) : null}
          <p className="mt-2 text-xs text-ink-faint">{t('ui.sync.optional')}</p>
        </>
      )}
    </section>
  );
}

/** The three words the card has room for. Everything else is a line below it. */
function state(status: SyncStatus): 'synced' | 'working' | 'error' {
  if (status === 'error') return 'error';
  return status === 'synced' ? 'synced' : 'working';
}

/** The letter on the disc: the account's, upper-cased, or nothing to show. */
function initial(account: { email: string | null; name: string | null } | null): string {
  const source = account?.name || account?.email || '';
  return source.trim().slice(0, 1).toUpperCase();
}
