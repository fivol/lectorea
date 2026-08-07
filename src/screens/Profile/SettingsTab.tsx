import { useState } from 'react';
import { useT } from '@/i18n';
import { useProfile } from '@/store/profile';
import Icon from '@/components/Icon';

export default function SettingsTab() {
  const { t } = useT();
  const settings = useProfile((state) => state.profile.settings);
  const setSetting = useProfile((state) => state.setSetting);
  const resetProfile = useProfile((state) => state.resetProfile);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="max-w-lg space-y-6 p-4">
      <Row label={t('ui.profile.settings.lang')}>
        <select
          value={settings.lang}
          onChange={(event) => setSetting('lang', event.target.value)}
          className="rounded border border-line bg-surface-2 px-2 py-1 text-sm"
        >
          <option value="ru">Русский</option>
        </select>
      </Row>

      <Row label={t('ui.profile.settings.theme')}>
        <Segmented
          value={settings.theme}
          options={(['auto', 'light', 'dark'] as const).map((value) => ({
            value,
            label: t(`ui.profile.settings.theme.${value}`),
          }))}
          onChange={(value) => setSetting('theme', value)}
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
        />
      </Row>

      <div className="border-t border-line pt-4">
        {confirming ? (
          <div className="surface border-danger/40 p-3">
            <p className="mb-3 text-sm text-ink-dim">{t('ui.profile.settings.resetConfirm')}</p>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn"
                style={{ background: 'var(--c-danger)', color: '#fff', borderColor: 'transparent' }}
                onClick={() => {
                  resetProfile();
                  setConfirming(false);
                }}
              >
                {t('ui.profile.settings.resetDo')}
              </button>
              <button type="button" className="btn" onClick={() => setConfirming(false)}>
                {t('ui.common.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="btn text-danger"
            onClick={() => setConfirming(true)}
          >
            <Icon name="warning" size={14} />
            {t('ui.profile.settings.reset')}
          </button>
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

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-lg border border-line" role="group">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={`px-3 py-1.5 text-sm transition-colors
                      ${value === option.value ? 'bg-surface-2 text-ink' : 'text-ink-faint hover:text-ink'}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
