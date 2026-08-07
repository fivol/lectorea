import { useMemo, useState } from 'react';
import type { BuiltPlaylist, LectureLength, ProviderType } from '@shared/schema';
import { normalize } from '@shared/search';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import Dropdown, { Caption, CheckRow, RadioRow, RangeRow } from '@/components/Dropdown';
import Icon from '@/components/Icon';
import {
  activeFilterCount,
  facetsOf,
  SORT_KEYS,
  type PlaylistFilterState,
  type SortKey,
} from './playlist-filters';

type Props = {
  playlists: BuiltPlaylist[];
  state: PlaylistFilterState;
  onChange: (next: PlaylistFilterState) => void;
  sort: SortKey;
  onSortChange: (next: SortKey) => void;
  onReset: () => void;
};

const LECTURE_LENGTHS: LectureLength[] = ['lesson', 'pair', 'double', 'long'];
const KINDS: BuiltPlaylist['kind'][] = ['lectures', 'seminars', 'mixed'];
const PROVIDER_TYPES: ProviderType[] = ['university', 'platform', 'individual'];

const LANG_LABELS: Record<string, string> = { ru: 'Русский', en: 'English' };

export default function PlaylistFilters({
  playlists,
  state,
  onChange,
  sort,
  onSortChange,
  onReset,
}: Props) {
  const { t } = useT();
  const catalog = useCatalog();
  const facets = facetsOf(playlists);
  const activeCount = activeFilterCount(state);

  // The provider list is the only facet long enough to need finding rather than
  // scanning — a popular course pulls in a couple of dozen channels.
  const [providerQuery, setProviderQuery] = useState('');
  const shownProviders = useMemo(() => {
    const needle = normalize(providerQuery);
    if (!needle) return facets.providers;
    return facets.providers.filter((id) =>
      normalize(catalog.providers[id]?.title ?? id).includes(needle)
    );
  }, [facets.providers, providerQuery, catalog.providers]);

  const toggle = <K extends keyof PlaylistFilterState>(
    key: K,
    list: string[],
    value: string
  ): void => {
    const next = list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
    onChange({ ...state, [key]: next } as PlaylistFilterState);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Dropdown
          label={t('ui.filters.lang')}
          active={state.langs.length > 0}
        >
          {facets.langs.map((lang) => (
            <CheckRow
              key={lang}
              checked={state.langs.includes(lang)}
              onChange={() => toggle('langs', state.langs, lang)}
            >
              {LANG_LABELS[lang] ?? lang}
            </CheckRow>
          ))}
        </Dropdown>

        <Dropdown
          label={t('ui.filters.provider')}
          active={state.providers.length > 0}
          search={{
            value: providerQuery,
            onChange: setProviderQuery,
            placeholder: t('ui.filter.searchProvider'),
          }}
        >
          <Caption>
            {providerQuery
              ? t('ui.filter.found', { n: shownProviders.length })
              : t('ui.filter.popular')}
          </Caption>
          {shownProviders.length ? null : (
            <p className="px-2 py-1.5 text-sm text-ink-faint">{t('ui.search.empty')}</p>
          )}
          {shownProviders.map((id) => (
            <CheckRow
              key={id}
              checked={state.providers.includes(id)}
              onChange={() => toggle('providers', state.providers, id)}
            >
              {catalog.providers[id]?.title ?? id}
            </CheckRow>
          ))}
        </Dropdown>

        <Dropdown label={t('ui.filters.providerType')} active={state.providerTypes.length > 0}>
          {PROVIDER_TYPES.map((type) => (
            <CheckRow
              key={type}
              checked={state.providerTypes.includes(type)}
              onChange={() => toggle('providerTypes', state.providerTypes, type)}
            >
              {t(`ui.filters.providerType.${type}`)}
            </CheckRow>
          ))}
        </Dropdown>

        <Dropdown label={t('ui.filters.lecturer')} active={Boolean(state.lecturer)}>
          <input
            type="text"
            value={state.lecturer}
            list="lecturer-options"
            onChange={(event) => onChange({ ...state, lecturer: event.target.value })}
            placeholder={t('ui.filters.lecturerPlaceholder')}
            className="w-full rounded border border-line bg-surface-2 px-2 py-1 text-sm outline-none"
          />
          <datalist id="lecturer-options">
            {facets.lecturers.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </Dropdown>

        {facets.countRange ? (
          <Dropdown label={t('ui.filters.videoCount')} active={Boolean(state.videoCount)}>
            <RangeRow
              min={facets.countRange[0]}
              max={facets.countRange[1]}
              value={state.videoCount ?? facets.countRange}
              onChange={(next) => onChange({ ...state, videoCount: next })}
            />
          </Dropdown>
        ) : null}

        <Dropdown label={t('ui.filters.lectureLength')} active={state.lectureLengths.length > 0}>
          {LECTURE_LENGTHS.map((length) => (
            <CheckRow
              key={length}
              checked={state.lectureLengths.includes(length)}
              onChange={() => toggle('lectureLengths', state.lectureLengths, length)}
            >
              {t(`ui.playlist.length.${length}`)}
            </CheckRow>
          ))}
        </Dropdown>

        <Dropdown label={t('ui.filters.captions')} active={Boolean(state.captions)}>
          <RadioRow checked={!state.captions} onChange={() => onChange({ ...state, captions: null })}>
            {t('ui.common.all')}
          </RadioRow>
          <RadioRow
            checked={state.captions === 'any'}
            onChange={() => onChange({ ...state, captions: 'any' })}
          >
            {t('ui.filters.captions.any')}
          </RadioRow>
          <RadioRow
            checked={state.captions === 'ru'}
            onChange={() => onChange({ ...state, captions: 'ru' })}
          >
            {t('ui.filters.captions.ru')}
          </RadioRow>
        </Dropdown>

        <Dropdown label={t('ui.filters.kind')} active={state.kinds.length > 0}>
          {KINDS.map((kind) => (
            <CheckRow
              key={kind}
              checked={state.kinds.includes(kind)}
              onChange={() => toggle('kinds', state.kinds, kind)}
            >
              {t(`ui.playlist.kind.${kind}`)}
            </CheckRow>
          ))}
        </Dropdown>

        {facets.yearRange ? (
          <Dropdown label={t('ui.filters.year')} active={Boolean(state.years)}>
            <RangeRow
              min={facets.yearRange[0]}
              max={facets.yearRange[1]}
              value={state.years ?? facets.yearRange}
              onChange={(next) => onChange({ ...state, years: next })}
            />
          </Dropdown>
        ) : null}

        <Dropdown label={t('ui.filters.mine')} active={state.hideWatched || state.onlyFavorite}>
          <CheckRow
            checked={state.fullOnly}
            onChange={(next) => onChange({ ...state, fullOnly: next })}
          >
            {t('ui.filters.completeness')}
          </CheckRow>
          <CheckRow
            checked={state.hideWatched}
            onChange={(next) => onChange({ ...state, hideWatched: next })}
          >
            {t('ui.filters.mine.hideWatched')}
          </CheckRow>
          <CheckRow
            checked={state.onlyFavorite}
            onChange={(next) => onChange({ ...state, onlyFavorite: next })}
          >
            {t('ui.filters.mine.onlyFavorite')}
          </CheckRow>
        </Dropdown>

        <Dropdown
          label={
            <span className="flex items-center gap-1">
              <Icon name="sort" size={12} />
              {t(`ui.sort.${sort}`)}
            </span>
          }
          align="right"
          className="ml-auto"
        >
          {SORT_KEYS.map((key) => (
            <RadioRow key={key} checked={sort === key} onChange={() => onSortChange(key)}>
              {t(`ui.sort.${key}`)}
            </RadioRow>
          ))}
        </Dropdown>
      </div>

      {activeCount > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <ActiveChips state={state} onChange={onChange} />
          <button type="button" className="btn-ghost text-xs" onClick={onReset}>
            {t('ui.filter.resetAll')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Every active filter is removable on its own — that is what keeps them honest. */
function ActiveChips({
  state,
  onChange,
}: {
  state: PlaylistFilterState;
  onChange: (next: PlaylistFilterState) => void;
}) {
  const { t } = useT();
  const catalog = useCatalog();

  const chips: Array<{ key: string; label: string; clear: () => void }> = [];

  for (const lang of state.langs) {
    chips.push({
      key: `lang:${lang}`,
      label: LANG_LABELS[lang] ?? lang,
      clear: () => onChange({ ...state, langs: state.langs.filter((item) => item !== lang) }),
    });
  }
  for (const id of state.providers) {
    chips.push({
      key: `provider:${id}`,
      label: catalog.providers[id]?.title ?? id,
      clear: () =>
        onChange({ ...state, providers: state.providers.filter((item) => item !== id) }),
    });
  }
  for (const type of state.providerTypes) {
    chips.push({
      key: `type:${type}`,
      label: t(`ui.filters.providerType.${type}`),
      clear: () =>
        onChange({
          ...state,
          providerTypes: state.providerTypes.filter((item) => item !== type),
        }),
    });
  }
  for (const length of state.lectureLengths) {
    chips.push({
      key: `len:${length}`,
      label: t(`ui.playlist.length.${length}`),
      clear: () =>
        onChange({
          ...state,
          lectureLengths: state.lectureLengths.filter((item) => item !== length),
        }),
    });
  }
  for (const kind of state.kinds) {
    chips.push({
      key: `kind:${kind}`,
      label: t(`ui.playlist.kind.${kind}`),
      clear: () => onChange({ ...state, kinds: state.kinds.filter((item) => item !== kind) }),
    });
  }
  if (state.lecturer.trim()) {
    chips.push({
      key: 'lecturer',
      label: state.lecturer,
      clear: () => onChange({ ...state, lecturer: '' }),
    });
  }
  if (state.captions) {
    chips.push({
      key: 'captions',
      label: t(`ui.filters.captions.${state.captions}`),
      clear: () => onChange({ ...state, captions: null }),
    });
  }
  if (state.videoCount) {
    chips.push({
      key: 'count',
      label: `${state.videoCount[0]}–${state.videoCount[1]}`,
      clear: () => onChange({ ...state, videoCount: null }),
    });
  }
  if (state.years) {
    chips.push({
      key: 'years',
      label: `${state.years[0]}–${state.years[1]}`,
      clear: () => onChange({ ...state, years: null }),
    });
  }
  if (state.fullOnly) {
    chips.push({
      key: 'full',
      label: t('ui.filters.completeness'),
      clear: () => onChange({ ...state, fullOnly: false }),
    });
  }
  if (state.hideWatched) {
    chips.push({
      key: 'watched',
      label: t('ui.filters.mine.hideWatched'),
      clear: () => onChange({ ...state, hideWatched: false }),
    });
  }
  if (state.onlyFavorite) {
    chips.push({
      key: 'fav',
      label: t('ui.filters.mine.onlyFavorite'),
      clear: () => onChange({ ...state, onlyFavorite: false }),
    });
  }

  return (
    <>
      {chips.map((chip) => (
        <span key={chip.key} className="chip">
          {chip.label}
          <button type="button" onClick={chip.clear} aria-label={`${t('ui.common.reset')} ${chip.label}`}>
            <Icon name="close" size={11} />
          </button>
        </span>
      ))}
    </>
  );
}
