import { useMemo, useState } from 'react';
import type { BuiltPlaylist, LectureLength, PlaylistType, ProviderType } from '@shared/schema';
import { normalize } from '@shared/search';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import Dropdown, { Caption, CheckRow, RadioRow, RangeRow } from '@/components/Dropdown';
import Icon from '@/components/Icon';
import { Button, Chip } from '@/components/ui';
import {
  activeFilterCount,
  facetsOf,
  LANG_LABELS,
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

const LECTURE_LENGTHS: LectureLength[] = ['short', 'lesson', 'pair', 'double', 'long'];
/**
 * All four, «Лекции» included — the row does not print it because it describes
 * two thirds of the catalogue, but «show me the courses and not the shelves» is
 * exactly what somebody would come to this dropdown to ask.
 */
const TYPES: PlaylistType[] = ['lectures', 'course', 'seminars', 'collection'];
const PROVIDER_TYPES: ProviderType[] = ['university', 'platform', 'individual'];

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

  /** Unfolds the strip into a wrapped block — scrolling is the default, not the only way. */
  const [expanded, setExpanded] = useState(false);

  /** How the rating is built, opened by a press — see the note beside it below. */
  const [statusHow, setStatusHow] = useState(false);

  // Languages the course has, plus whatever the filter is already asking for:
  // the filter defaults to the interface language even for a course that has
  // nothing in it, and a dropdown that cannot untick its own active row is a
  // dead end.
  const langOptions = [...new Set([...facets.langs, ...state.langs])].sort();

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

  // The lecturer filter is a substring match, so what is typed is both the
  // query and the filter itself — the list below narrows as it is refined.
  const shownLecturers = useMemo(() => {
    const needle = normalize(state.lecturer);
    if (!needle) return facets.lecturers;
    return facets.lecturers.filter((name) => normalize(name).includes(needle));
  }, [facets.lecturers, state.lecturer]);

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
      {/*
        One strip, in the order people actually reach for these: language and
        university first, the long tail last. Wrapped over four rows it cost more
        height than the playlists it was filtering, so by default it scrolls
        sideways and «Все фильтры» unfolds the lot for anyone who would rather
        see them at once.
      */}
      <div className="flex items-start gap-1.5">
        <div
          // Two details that are not decoration: `py-1` keeps the strip from
          // clipping the focus ring of the chips it scrolls, and the children
          // must refuse to shrink or they wrap their labels onto two lines
          // instead of running off the end.
          className={`flex min-w-0 flex-1 items-center gap-1.5 py-1 [&>*]:shrink-0
                      ${expanded ? 'flex-wrap' : 'scroll-x'}`}
        >
          <Dropdown
            label={t('ui.filters.lang')}
            active={state.langs.length > 0}
          >
            {langOptions.map((lang) => (
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

          {/* A field with a `datalist` behind it showed nothing until something
              was typed, and what it then showed was up to the browser. The
              names are right here — listed, they say who recorded this course
              before anyone has to guess at a spelling. And when none of the
              recordings names a lecturer, the filter itself has nothing to
              offer, so it goes away like the year and count ranges do. */}
          {facets.lecturers.length || state.lecturer ? (
            <Dropdown
              label={t('ui.filters.lecturer')}
              active={Boolean(state.lecturer)}
              search={{
                value: state.lecturer,
                onChange: (next) => onChange({ ...state, lecturer: next }),
                placeholder: t('ui.filters.lecturerPlaceholder'),
              }}
            >
              <Caption>
                {state.lecturer.trim()
                  ? t('ui.filter.found', { n: shownLecturers.length })
                  : t('ui.filter.popular')}
              </Caption>
              {shownLecturers.length ? null : (
                <p className="px-2 py-1.5 text-sm text-ink-faint">{t('ui.search.empty')}</p>
              )}
              {shownLecturers.map((name) => (
                <RadioRow
                  key={name}
                  checked={state.lecturer === name}
                  onChange={() => onChange({ ...state, lecturer: name })}
                >
                  {name}
                </RadioRow>
              ))}
            </Dropdown>
          ) : null}

          <Dropdown label={t('ui.filters.kind')} active={state.types.length > 0}>
            {TYPES.map((type) => (
              <CheckRow
                key={type}
                checked={state.types.includes(type)}
                onChange={() => toggle('types', state.types, type)}
              >
                {t(`ui.playlist.type.${type}`)}
              </CheckRow>
            ))}
          </Dropdown>

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
        </div>

        {/* An icon, and the same chip shape as the row it ends: a text button
            here sat on transparent background with a half-cut filter sliding
            under it. Opaque and square, it reads as the end of the strip. */}
        <Chip
          on={expanded}
          icon="sliders"
          iconSize={14}
          className="mt-1 shrink-0 px-2"
          onClick={() => setExpanded((value) => !value)}
          ariaExpanded={expanded}
          ariaLabel={expanded ? t('ui.filters.fewer') : t('ui.filters.showAll')}
          title={expanded ? t('ui.filters.fewer') : t('ui.filters.showAll')}
        >
          {null}
        </Chip>
      </div>

      {/*
        Sorting is not a filter, and sitting at the end of the same strip it read
        as one more of them. Its own row keeps the two apart, next to the chips
        that say what the filters above are currently doing.
      */}
      <div className="flex flex-wrap items-center gap-1.5">
        {activeCount > 0 ? (
          <>
            <ActiveChips state={state} onChange={onChange} />
            <Button variant="ghost" small onClick={onReset}>
              {t('ui.filter.resetAll')}
            </Button>
          </>
        ) : null}

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
          {/* «Оценка» is the default order, so the question of what that order
              is belongs here as much as it does on the badge in each row.

              A question opened by a press rather than by hover: this was the one
              place in the product that said what the rating is made of, and it
              said it in a tooltip — which is to say it said nothing at all to
              anyone reading on a phone. */}
          <div className="mt-1 border-t border-line px-2 pt-2">
            <button
              type="button"
              onClick={() => setStatusHow((value) => !value)}
              aria-expanded={statusHow}
              className="flex w-full items-center gap-1.5 text-left text-[11px] text-ink-faint
                         transition-colors duration-fast ease-out hover:text-ink-dim"
            >
              <Icon name="help" size={12} />
              {t('ui.playlist.statusHow')}
            </button>
            {statusHow ? (
              <p className="mt-1.5 text-[11px] leading-snug text-ink-faint">
                {t('ui.playlist.ratingTooltip')}
              </p>
            ) : null}
          </div>
        </Dropdown>
      </div>
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
  for (const type of state.types) {
    chips.push({
      key: `type:${type}`,
      label: t(`ui.playlist.type.${type}`),
      clear: () => onChange({ ...state, types: state.types.filter((item) => item !== type) }),
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
        /* No transition on the neighbours: flex moves them the instant one is
           removed, and a list that slides closed under the cursor makes the
           next × land somewhere else. Only the chip itself animates. */
        <Chip key={chip.key} className="animate-scale-in">
          {chip.label}
          <button type="button" onClick={chip.clear} aria-label={`${t('ui.common.reset')} ${chip.label}`}>
            <Icon name="close" size={11} />
          </button>
        </Chip>
      ))}
    </>
  );
}
