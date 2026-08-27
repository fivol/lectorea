import { useT } from '@/i18n';
import { SYNC_AVAILABLE, useSync } from '@/store/sync';
import { useUi } from '@/store/ui';
import Icon from '@/components/Icon';
import { Button } from '@/components/ui';

/**
 * Where this progress lives besides this browser — said on the desk, always,
 * in one line.
 *
 * The site's one standing promise is that nothing about a reader leaves the
 * browser unless they ask, and the way that used to be honoured here was
 * silence: the account was mentioned in exactly one place, after three
 * separate days of study, as a warning about what could be lost. That is the
 * right instinct about *nagging* and the wrong answer for the reader who came
 * looking. Studying happens on a laptop in the evening and on a phone on the
 * way to work, and somebody who wants the second to know what the first did has
 * to be able to find the sign-in without being told where it hides.
 *
 * So it is a status line rather than a plea. Signed out it says where the
 * profile is kept and offers the other option, once, without an argument about
 * loss; signed in it says which account is carrying it and whether the last
 * write went through. Both open the same drawer, on the tab with the account
 * on it.
 *
 * Nothing at all in a build with no Firebase project — a fork, a checkout,
 * `pnpm dev` — where the file in «Данные» is the whole of the answer.
 */
export default function AccountRow({ empty = false }: { empty?: boolean }) {
  const { t } = useT();
  const account = useSync((state) => state.account);
  const status = useSync((state) => state.status);
  const openProfile = useUi((state) => state.openProfile);

  if (!SYNC_AVAILABLE) return null;

  if (!account) {
    return (
      <section className="surface flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
        <Icon name="cloud-off" size={14} className="shrink-0 text-ink-faint" />
        {/*
          A desk with nothing on it is the second device, more often than it is
          a first visit — the laptop has the year of study and the phone in
          somebody's hand has never been signed in. So the empty page asks the
          question that fits it: not "this is only in this browser", which is
          a warning about nothing, but "were you studying somewhere else?".
        */}
        <p className="min-w-0 flex-1 text-xs text-ink-dim">
          {empty ? t('ui.sync.elsewhere') : t('ui.sync.nudge')}
        </p>
        <Button small icon="sync" onClick={() => openProfile('account')}>
          {empty ? t('ui.sync.elsewhereAction') : t('ui.sync.nudgeAction')}
        </Button>
      </section>
    );
  }

  const failed = status === 'error';

  return (
    <button
      type="button"
      onClick={() => openProfile('account')}
      className="surface flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors
                 duration-fast ease-out hover:border-accent"
    >
      <Icon
        name={failed ? 'warning' : 'cloud'}
        size={14}
        className={`shrink-0 ${failed ? 'text-danger' : 'text-ink-faint'}`}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs text-ink-dim">
          {account.email ?? account.name}
          {' · '}
          {t(`ui.sync.state.${failed ? 'error' : 'synced'}`)}
        </span>
      </span>
      <Icon name="chevron-right" size={12} className="shrink-0 text-ink-faint" />
    </button>
  );
}
