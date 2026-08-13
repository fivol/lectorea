import { useState } from 'react';
import { UI_LANGS, UiLang } from '@shared/schema';
import { useT } from '@/i18n';
import { useProfile } from '@/store/profile';
import { Button, Segmented, Select } from '@/components/ui';

export default function SettingsTab() {
  const { t } = useT();
  const settings = useProfile((state) => state.profile.settings);
  const setSetting = useProfile((state) => state.setSetting);
  const resetProfile = useProfile((state) => state.resetProfile);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="max-w-lg space-y-6 p-4">
      {/* Also in the header, where someone who cannot read this screen will
          find it. Here for completeness, and because a language named in full
          in its own script is unambiguous in a way that «RU» is not. */}
      <Row label={t('ui.profile.settings.lang')}>
        <Select
          value={settings.lang}
          onChange={(event) => setSetting('lang', UiLang.parse(event.target.value))}
        >
          {UI_LANGS.map((entry) => (
            <option key={entry.id} value={entry.id} lang={entry.id}>
              {entry.name}
            </option>
          ))}
        </Select>
      </Row>

      <Row label={t('ui.profile.settings.theme')}>
        <Segmented
          value={settings.theme}
          options={(['auto', 'light', 'dark'] as const).map((value) => ({
            value,
            label: t(`ui.profile.settings.theme.${value}`),
          }))}
          onChange={(value) => setSetting('theme', value)}
          label={t('ui.profile.settings.theme')}
        />
      </Row>

      {/* Which lectures are behind you is the progress itself and has no
          switch — turning that off would be turning the feature off. The
          minute you paused at is a different thing to record, and some people
          would rather it were not. */}
      <div>
        <Row label={t('ui.profile.settings.resume')}>
          <Segmented
            value={settings.resume ? 'on' : 'off'}
            options={(['on', 'off'] as const).map((value) => ({
              value,
              label: t(`ui.profile.settings.resume.${value}`),
            }))}
            onChange={(value) => setSetting('resume', value === 'on')}
            label={t('ui.profile.settings.resume')}
          />
        </Row>
        <p className="mt-1 text-xs text-ink-faint">{t('ui.profile.settings.resumeHint')}</p>
      </div>

      {/* Map or blocks is not here any more: the map is the front door and
          every visit opens on it, so the choice holds for the visit and lives
          in the switch on the map's own header, where the two views are. */}

      <div className="border-t border-line pt-4">
        {confirming ? (
          <div className="surface border-danger/40 p-3">
            <p className="mb-3 text-sm text-ink-dim">{t('ui.profile.settings.resetConfirm')}</p>
            <div className="flex gap-2">
              <Button
                variant="danger"
                onClick={() => {
                  resetProfile();
                  setConfirming(false);
                }}
              >
                {t('ui.profile.settings.resetDo')}
              </Button>
              <Button onClick={() => setConfirming(false)}>{t('ui.common.cancel')}</Button>
            </div>
          </div>
        ) : (
          <Button icon="warning" className="text-danger" onClick={() => setConfirming(true)}>
            {t('ui.profile.settings.reset')}
          </Button>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-ink-dim">{label}</span>
      {children}
    </div>
  );
}
