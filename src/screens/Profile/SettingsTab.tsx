import { useState } from 'react';
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
      <Row label={t('ui.profile.settings.lang')}>
        <Select
          value={settings.lang}
          onChange={(event) => setSetting('lang', event.target.value)}
        >
          <option value="ru">Русский</option>
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

      <Row label={t('ui.profile.settings.mapView')}>
        <Segmented
          value={settings.mapView}
          options={(['map', 'blocks'] as const).map((value) => ({
            value,
            label: t(`ui.view.${value}`),
          }))}
          onChange={(value) => setSetting('mapView', value)}
          label={t('ui.profile.settings.mapView')}
        />
      </Row>

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
