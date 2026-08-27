import { useState } from 'react';
import { useT } from '@/i18n';
import { rememberedEmail } from '@/lib/sync';
import { SYNC_AVAILABLE, useSync, type SyncStatus } from '@/store/sync';
import Icon from '@/components/Icon';
import { Button, Input } from '@/components/ui';

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
  const signOut = useSync((state) => state.signOut);
  const forget = useSync((state) => state.forget);
  const pending = useSync((state) => state.pending);
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

          {pending ? <LinkFlow /> : <Ways />}

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

/**
 * The two doors, side by side rather than one behind the other.
 *
 * Google is the press most people will make and is the accented one; the letter
 * is for everybody without a Google account, and for the case Google's popup
 * handles worst — a phone. Neither is presented as the fallback of the other,
 * because for the reader who needs the second one it is not a fallback.
 */
function Ways() {
  const { t } = useT();
  const busy = useSync((state) => state.busy);
  const status = useSync((state) => state.status);
  const signIn = useSync((state) => state.signIn);
  const openLink = useSync((state) => state.openLink);
  const waiting = busy || status === 'connecting';

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <Button variant="primary" icon="google" disabled={waiting} onClick={signIn}>
        {t('ui.sync.signIn')}
      </Button>
      <Button icon="mail" disabled={waiting} onClick={openLink}>
        {t('ui.sync.byEmail')}
      </Button>
    </div>
  );
}

/**
 * Asking for an address, and waiting for the link to be opened.
 *
 * Three states in one plate: type it, we have sent it, and — the one that looks
 * like a failure and is not — confirm it, which is what a link opened on a
 * second device asks for. Firebase will not take the address out of the link
 * itself, because a link is a bearer token; being asked on the phone is that
 * check working.
 */
function LinkFlow() {
  const { t } = useT();
  const pending = useSync((state) => state.pending);
  const busy = useSync((state) => state.busy);
  const sendLink = useSync((state) => state.sendLink);
  const finishLink = useSync((state) => state.finishLink);
  const cancelLink = useSync((state) => state.cancelLink);
  const [email, setEmail] = useState(() => rememberedEmail() ?? '');

  if (pending?.kind === 'sent') {
    return (
      <div className="surface mt-3 p-3">
        <p className="flex items-start gap-2 text-sm">
          <Icon name="mail" size={14} className="mt-0.5 text-accent" />
          {t('ui.sync.sent', { email: pending.email })}
        </p>
        <div className="mt-3 flex gap-2">
          <Button small disabled={busy} onClick={() => sendLink(pending.email)}>
            {t('ui.sync.sendAgain')}
          </Button>
          <Button variant="ghost" small onClick={cancelLink}>
            {t('ui.common.cancel')}
          </Button>
        </div>
      </div>
    );
  }

  const confirming = pending?.kind === 'confirm';
  const submit = (): void => {
    const address = email.trim();
    if (!address) return;
    if (confirming) finishLink(address);
    else sendLink(address);
  };

  return (
    <form
      className="surface mt-3 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <p className="text-sm">
        {confirming ? t('ui.sync.confirmEmail') : t('ui.sync.askEmail')}
      </p>
      {/* The field on its own line rather than sharing one with the buttons: an
          address is the longest thing anybody types on this screen, and a row
          that has to hold it *and* two capsules gives it whatever is left —
          which on a phone was eight characters. */}
      <Input
        type="email"
        value={email}
        autoFocus
        required
        autoComplete="email"
        inputMode="email"
        placeholder={t('ui.sync.emailPlaceholder')}
        className="mt-2 w-full"
        onChange={(event) => setEmail(event.target.value)}
      />
      <div className="mt-2 flex gap-2">
        <Button type="submit" variant="primary" disabled={busy || !email.trim()}>
          {confirming ? t('ui.sync.finish') : t('ui.sync.sendLink')}
        </Button>
        <Button variant="ghost" small onClick={cancelLink}>
          {t('ui.common.cancel')}
        </Button>
      </div>
    </form>
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
