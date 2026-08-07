import { useRef, useState } from 'react';
import { useT } from '@/i18n';
import { formatDate } from '@/lib/format';
import { downloadProfile, parseProfile, type ImportPreview } from '@/lib/profile-io';
import { useProfile } from '@/store/profile';
import Icon from '@/components/Icon';

export default function DataTab() {
  const { t, plural, lang } = useT();
  const profile = useProfile((state) => state.profile);
  const replaceProfile = useProfile((state) => state.replaceProfile);
  const mergeProfile = useProfile((state) => state.mergeProfile);

  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [invalid, setInvalid] = useState(false);

  const inspect = (value: string): void => {
    setText(value);
    if (!value.trim()) {
      setPreview(null);
      setInvalid(false);
      return;
    }
    const parsed = parseProfile(value);
    setPreview(parsed);
    setInvalid(!parsed);
  };

  const readFile = async (file: File): Promise<void> => {
    inspect(await file.text());
  };

  const finish = (): void => {
    setText('');
    setPreview(null);
    setInvalid(false);
  };

  return (
    <div className="max-w-lg space-y-8 p-4">
      <section>
        <h3 className="text-sm font-medium">{t('ui.profile.data.export')}</h3>
        <p className="mt-1 text-xs text-ink-faint">{t('ui.profile.data.exportHint')}</p>
        <button type="button" className="btn mt-2" onClick={() => downloadProfile(profile)}>
          <Icon name="download" size={14} />
          {t('ui.profile.data.export')}
        </button>
      </section>

      <section className="border-t border-line pt-6">
        <h3 className="text-sm font-medium">{t('ui.profile.data.import')}</h3>
        <p className="mt-1 text-xs text-ink-faint">{t('ui.profile.data.importHint')}</p>

        <div className="mt-2 flex gap-2">
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" size={14} />
            {t('ui.profile.data.importFile')}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void readFile(file);
            }}
          />
        </div>

        <textarea
          value={text}
          onChange={(event) => inspect(event.target.value)}
          placeholder={t('ui.profile.data.importPaste')}
          rows={5}
          className="mt-2 w-full rounded-lg border border-line bg-surface-2 p-2 font-mono text-xs
                     outline-none placeholder:text-ink-faint"
        />

        {invalid ? (
          <p className="mt-2 flex items-center gap-2 text-xs text-danger">
            <Icon name="warning" size={12} />
            {t('ui.profile.data.invalid')}
          </p>
        ) : null}

        {preview ? (
          <div className="surface mt-3 p-3">
            <p className="text-xs uppercase tracking-wide text-ink-faint">
              {t('ui.profile.data.preview')}
            </p>
            <p className="num mt-1 text-sm">
              {t('ui.profile.data.previewSummary', {
                courses: preview.courses,
                courseWord: plural(preview.courses, 'course'),
                playlists: preview.playlists,
                playlistWord: plural(preview.playlists, 'playlist'),
                date: formatDate(preview.updatedAt, lang),
              })}
            </p>
            <p className="mt-2 text-xs text-ink-faint">{t('ui.profile.data.mergeHint')}</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  mergeProfile(preview.profile);
                  finish();
                }}
              >
                {t('ui.profile.data.merge')}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  replaceProfile(preview.profile);
                  finish();
                }}
              >
                {t('ui.profile.data.replace')}
              </button>
              <button type="button" className="btn-ghost text-xs" onClick={finish}>
                {t('ui.common.cancel')}
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
