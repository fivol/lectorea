import { useRef, useState } from 'react';
import { useT } from '@/i18n';
import { formatDate } from '@/lib/format';
import { downloadProfile, parseProfile, type ImportPreview } from '@/lib/profile-io';
import { useProfile } from '@/store/profile';
import Icon from '@/components/Icon';
import { Button, Textarea } from '@/components/ui';

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
        <Button icon="download" className="mt-2" onClick={() => downloadProfile(profile)}>
          {t('ui.profile.data.export')}
        </Button>
      </section>

      <section className="border-t border-line pt-6">
        <h3 className="text-sm font-medium">{t('ui.profile.data.import')}</h3>
        <p className="mt-1 text-xs text-ink-faint">{t('ui.profile.data.importHint')}</p>

        <div className="mt-2 flex gap-2">
          <Button icon="upload" onClick={() => fileRef.current?.click()}>
            {t('ui.profile.data.importFile')}
          </Button>
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

        <Textarea
          value={text}
          onChange={(event) => inspect(event.target.value)}
          placeholder={t('ui.profile.data.importPaste')}
          rows={5}
          className="mt-2 font-mono text-xs"
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
                videos: preview.videos,
                videoWord: plural(preview.videos, 'lecture'),
                date: formatDate(preview.updatedAt, lang),
              })}
            </p>
            <p className="mt-2 text-xs text-ink-faint">{t('ui.profile.data.mergeHint')}</p>
            <div className="mt-3 flex gap-2">
              <Button
                variant="primary"
                onClick={() => {
                  mergeProfile(preview.profile);
                  finish();
                }}
              >
                {t('ui.profile.data.merge')}
              </Button>
              <Button
                onClick={() => {
                  replaceProfile(preview.profile);
                  finish();
                }}
              >
                {t('ui.profile.data.replace')}
              </Button>
              <Button variant="ghost" small onClick={finish}>
                {t('ui.common.cancel')}
              </Button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
