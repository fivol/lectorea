import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import type { SearchEntry } from '@shared/schema';
import { matchedAlias, SEARCH_SECTION_ORDER } from '@shared/search';
import { useT } from '@/i18n';
import { searchTerm, track } from '@/lib/analytics';
import { useCatalog } from '@/lib/catalog';
import { useEscape, useIsMobile, useScrollLock } from '@/lib/hooks';
import { EDGE, placeBy, samePlace, type Placement } from '@/lib/popover';
import { suggestCourseUrl } from '@/lib/repo';
import { courseHref, fieldHref, useCatalogParams, useCourseSlice } from '@/lib/url';
import type { SearchResults, SearchSection } from '@/lib/search';
import Icon from './Icon';
import MarkedText from './MarkedText';
import { Field, IconButton, Kbd } from './ui';

type Props = {
  query: string;
  onQueryChange: (value: string) => void;
  results: SearchResults;
  /**
   * Floating pill on the map screen; inline field otherwise. `compact` is the
   * inline field on a wide screen and a search icon on a phone, where the field
   * would be a 160px slot in an already crowded toolbar.
   *
   * On a phone every variant opens the search screen — only what you tap to get
   * there differs: an icon for `compact`, the field itself for the other two.
   */
  variant?: 'floating' | 'inline' | 'compact';
  className?: string;
};

/** The dropdown is at least this wide — a name has to fit on one line. */
const PANEL_WIDTH = 340;

/**
 * The kinds of row, named for a report rather than by the one-letter tag the
 * index stores. Read alongside `search`: the term is what was asked and this is
 * what answered, and «искали курс, а выбрали вуз» is a fact about how the
 * catalogue is named that neither event says on its own.
 */
const ROW_KIND: Record<SearchEntry['t'], string> = {
  d: 'domain',
  c: 'course',
  p: 'playlist',
  v: 'provider',
  l: 'lecturer',
};

export default function SearchBox({
  query,
  onQueryChange,
  results,
  variant = 'inline',
  className = '',
}: Props) {
  const { t } = useT();
  const navigate = useNavigate();
  const params = useCatalogParams();
  const sliceAround = useCourseSlice();
  const isMobile = useIsMobile();

  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [place, setPlace] = useState<Partial<Placement & { width: number }>>({});

  /*
   * On a phone the field becomes a button and the search becomes a screen: a
   * back arrow, the field, and the whole height for the list. A 160px input
   * wedged between two icons is a target you aim at, and what it drops down is
   * a list read through a letterbox — the pattern every phone already teaches
   * is to leave the toolbar behind entirely while searching.
   *
   * The wide field on the first screen had the same letterbox under it: a
   * dropdown as wide as the phone truncates course names, ends up half covered
   * by the keyboard, and leaves the page scrolling behind it. Same screen there,
   * then — the field is wide enough to keep being the thing you tap.
   */
  const asSheet = isMobile;
  const [sheet, setSheet] = useState(false);

  const closeSheet = useCallback(() => {
    setSheet(false);
    // Backing out of the search leaves nothing behind: with the field gone the
    // query would still be there, invisible, and the next tap would open onto
    // someone else's half-typed word.
    onQueryChange('');
  }, [onQueryChange]);

  useEscape(sheet, closeSheet);
  useScrollLock(sheet);

  /*
   * Leaving the field takes the query with it. Half a word left standing in a
   * pill over the map is not a filter anyone set on purpose — it keeps dimming
   * every domain it missed, and whoever clicks the field next lands in the
   * middle of it.
   */
  const leave = useCallback(() => {
    setOpen(false);
    onQueryChange('');
  }, [onQueryChange]);

  /*
   * A typed query preselects its best hit, so Enter goes where the eye already
   * is. The default list has no best hit — nothing was asked for yet — and
   * preselecting its first row would send Enter to «Математика» for anyone who
   * focused the field and thought better of it. `-1` is "nothing yet"; ↓ picks.
   */
  useEffect(() => setActive(results.suggested ? -1 : 0), [results.query, results.suggested]);

  // `/` focuses the field from anywhere, as long as nothing else is being typed into.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;
      if (event.key === '/' && !typing) {
        event.preventDefault();
        if (asSheet) {
          setSheet(true);
        } else {
          inputRef.current?.focus();
          setOpen(true);
        }
      }
      // Second Escape — the one pressed when the field is no longer focused —
      // clears the query. The first only drops focus and keeps the highlight.
      if (event.key === 'Escape' && !typing && query) {
        onQueryChange('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [query, onQueryChange, asSheet]);

  // Before paint, so the panel never shows up in the top-left corner first.
  useLayoutEffect(() => {
    if (!open || asSheet) return;
    const measure = (): void => {
      const field = boxRef.current?.getBoundingClientRect();
      if (!field) return;
      // Never narrower than the field it hangs off — in the columns header that
      // field is a 160px slot, and a list scaled to it reads «Мат…  22 курса».
      const width = Math.min(
        Math.max(field.width, PANEL_WIDTH),
        window.innerWidth - EDGE * 2
      );
      const next = { ...placeBy(field, 'right', width), width };
      setPlace((prev) => (samePlace(prev, next) && prev.width === width ? prev : next));
    };
    measure();
    window.addEventListener('resize', measure);
    document.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      document.removeEventListener('scroll', measure, true);
    };
  }, [open, asSheet]);

  useEffect(() => {
    // Only while the list is open, which is only while the field has focus: the
    // sheet has its own way out, and once Escape has dropped the focus the
    // query belongs to the second press.
    if (asSheet || !open) return;
    const onPointerDown = (event: PointerEvent): void => {
      // The panel is portalled out of the field's box, so it has to be asked
      // about separately — otherwise the pointer that picks a row closes the
      // list from under itself and the click lands on the page behind.
      const target = event.target as Node;
      if (boxRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      leave();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [asSheet, open, leave]);

  const select = useCallback(
    (entry: SearchEntry) => {
      track('search_select', {
        kind: ROW_KIND[entry.t],
        // An id out of the catalogue, never the row's name: a lecturer row is
        // keyed by the name itself, and that is the one id worth withholding.
        item_id: entry.t === 'l' ? '' : entry.id,
        search_term: searchTerm(results.query),
        suggested: results.suggested,
      });
      switch (entry.t) {
        case 'd':
          // The same address a territory on the map leads to — see `fieldHref`.
          navigate(fieldHref(params.search, entry.id));
          setOpen(false);
          onQueryChange('');
          break;
        case 'c':
          navigate(courseHref(entry.id, sliceAround(entry.id)));
          setOpen(false);
          onQueryChange('');
          break;
        case 'p': {
          if (!entry.c) break;
          const search = new URLSearchParams(sliceAround(entry.c));
          search.set('playlist', entry.id);
          navigate(courseHref(entry.c, `?${search.toString()}`));
          setOpen(false);
          onQueryChange('');
          break;
        }
        // Vendors and lecturers do not navigate: they switch on a filter that
        // lives above both screens.
        case 'v':
          params.toggleProvider(entry.id);
          setOpen(false);
          break;
        case 'l':
          params.toggleLecturer(entry.id);
          setOpen(false);
          break;
      }
      // A row was chosen, so the search is over — including the screen it was
      // filling, or the filter it just switched on would be hidden behind it.
      // The screen takes the query with it: a vendor row leaves the query
      // standing, which is right under a dropdown that still shows it and wrong
      // once the field behind is a button reading «Область, курс, вуз…».
      if (sheet) closeSheet();
      else setSheet(false);
    },
    [navigate, onQueryChange, params, sliceAround, sheet, closeSheet, results]
  );

  /** ↑/↓/Enter over the list. Escape is the caller's, because backing out of a
   *  dropdown and backing out of a screen are not the same retreat. */
  const onNavKey = (
    event: React.KeyboardEvent<HTMLInputElement>,
    onEscape: () => void
  ): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(results.flat.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === 'Enter') {
      const entry = results.flat[active];
      if (entry) {
        event.preventDefault();
        select(entry);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onEscape();
    }
  };

  const list = (
    <Results results={results} active={active} onActivate={setActive} onSelect={select} />
  );

  if (asSheet) {
    return (
      <>
        {variant === 'compact' ? (
          /* A plate, like everything else in that corner of the header: as a
             button it was the one control in the row cut from a different
             material and a head taller than the rest. */
          <button
            type="button"
            className="plate plate-disc tap-soft"
            onClick={() => setSheet(true)}
            aria-label={t('ui.search.open')}
            aria-expanded={sheet}
          >
            <Icon name="search" size={16} />
          </button>
        ) : (
          /* Dressed as the field it replaces, so the first screen still opens
             with a search line across it rather than an icon in the corner —
             only taller, because now the whole line is the tap target. Its own
             text names it; an `aria-label` on top would give the screen reader
             one name and the eye another. */
          <button
            type="button"
            onClick={() => setSheet(true)}
            aria-haspopup="dialog"
            aria-expanded={sheet}
            className={`field w-full px-4 py-2.5 text-left ${className}`}
          >
            <Icon name="search" className="text-ink-faint" />
            <span className="min-w-0 flex-1 truncate text-base text-ink-dim">
              {t('ui.search.placeholder')}
            </span>
          </button>
        )}

        {sheet
          ? createPortal(
              <div
                role="dialog"
                aria-modal="true"
                aria-label={t('ui.search.open')}
                className="fixed inset-0 z-50 flex animate-fade-in flex-col bg-surface"
              >
                <div className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-2">
                  <IconButton
                    icon="arrow-left"
                    label={t('ui.common.back')}
                    tap
                    onClick={closeSheet}
                  />
                  <Field className="min-w-0 flex-1 px-3 py-2">
                    <Icon name="search" className="text-ink-faint" />
                    <input
                      ref={inputRef}
                      type="search"
                      // eslint-disable-next-line jsx-a11y/no-autofocus
                      autoFocus
                      value={query}
                      onChange={(event) => onQueryChange(event.target.value)}
                      onKeyDown={(event) => onNavKey(event, closeSheet)}
                      placeholder={t('ui.search.placeholder')}
                      aria-label={t('ui.search.placeholder')}
                      aria-controls="search-results"
                      role="combobox"
                      aria-expanded="true"
                      enterKeyHint="search"
                      autoComplete="off"
                      className="w-full bg-transparent text-base text-ink outline-none
                                 placeholder:text-ink-dim [&::-webkit-search-cancel-button]:hidden"
                    />
                    {/* Held open whether or not there is anything to clear: a
                        thumb-sized button appearing on the first letter would
                        push the line it is being typed on. Here the slot keeps
                        the button's full size — the field is a tap target, not
                        a place to save four pixels. */}
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center">
                      {query ? (
                        <IconButton
                          icon="close"
                          iconSize={14}
                          label={t('ui.search.clear')}
                          onClick={() => {
                            onQueryChange('');
                            inputRef.current?.focus();
                          }}
                        />
                      ) : null}
                    </span>
                  </Field>
                </div>

                {/* Here the line follows the list instead of being pinned under
                    it: a whole screen tall, a footer over that much empty space
                    reads as a bottom bar rather than as a footnote to the rows
                    above it. */}
                <div id="search-results" role="listbox" className="panel-scroll min-h-0 flex-1 p-2">
                  {list}
                  {results.suggested && !results.empty ? (
                    <Hint sections={results.sections} className="mx-1 mt-2" />
                  ) : null}
                </div>
              </div>,
              document.body
            )
          : null}
      </>
    );
  }

  const floating = variant === 'floating';

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <Field floating={floating} className={floating ? '' : 'px-3 py-1.5'}>
        <Icon name="search" className="text-ink-faint" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => {
            onQueryChange(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={(event) => {
            // Tab, or a click that landed on some other control — the focus
            // went somewhere nameable, and that is a departure. A blur with
            // nowhere to go (Escape, another window taking over) reports a
            // null `relatedTarget` and is not: Escape keeps its second press,
            // and coming back to the tab should find the search as it was.
            const next = event.relatedTarget as Node | null;
            if (!next || boxRef.current?.contains(next) || panelRef.current?.contains(next)) return;
            leave();
          }}
          onKeyDown={(event) =>
            onNavKey(event, () => {
              // Drops focus but keeps the highlight — that is the point of the
              // two steps: the second Escape clears the query.
              setOpen(false);
              inputRef.current?.blur();
            })
          }
          placeholder={t('ui.search.placeholder')}
          aria-label={t('ui.search.placeholder')}
          aria-expanded={open}
          aria-controls="search-results"
          role="combobox"
          autoComplete="off"
          className={`w-full bg-transparent text-ink outline-none placeholder:text-ink-dim
                      [&::-webkit-search-cancel-button]:hidden ${floating ? 'text-base' : 'text-sm'}`}
        />
        {/*
          One slot of a fixed size holds both. The key and the clear button are
          not the same shape, and swapping them on the first keystroke moved the
          input's right edge and the height of the row with it — the field
          twitched under the caret at the exact moment it was being typed into.
          The slot is the line's own height, so the pill is the same size at rest
          as it was before it had one.
        */}
        <span className="flex h-5 w-5 shrink-0 items-center justify-center">
          {query ? (
            <IconButton
              icon="close"
              iconSize={14}
              label={t('ui.search.clear')}
              className="h-5 w-5"
              onClick={() => {
                onQueryChange('');
                inputRef.current?.focus();
              }}
            />
          ) : (
            <Kbd className="hidden sm:block">/</Kbd>
          )}
        </span>
      </Field>

      {/*
        The panel opens on focus, not on the first keystroke. An empty dropdown
        under a field that says «Область, курс, вуз…» leaves the reader to take
        that on faith; the same three sections, filled with the largest of each,
        show what the catalogue is made of and that all three are searchable.
      */}
      {/*
        Portalled and pinned to the viewport, like every other layer over the
        catalogue: the field sits in a header that wraps and in a strip that
        scrolls sideways, and a list clipped by its own ancestor is worse than
        no list. The placement carries how much room is left under the field, so
        the panel scrolls inside itself instead of running off the window.
      */}
      {open
        ? createPortal(
            <div
              ref={panelRef}
              style={{ ...place, transformOrigin: place.bottom ? 'bottom' : 'top' }}
              className="glass-strong fixed z-50 flex flex-col overflow-hidden rounded-pop
                         border border-line animate-pop-in shadow-[var(--shadow-pop)]
                         backdrop-blur-xl"
            >
              <div id="search-results" role="listbox" className="panel-scroll min-h-0 flex-1 p-2">
                {list}
              </div>

              {results.suggested && !results.empty ? <Hint sections={results.sections} /> : null}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

/**
 * The way out of a search that found nothing.
 *
 * A catalogue that answers «ничего не найдено» and stops has told the one
 * person who knows what is missing that there is nothing to be done about it.
 * The form opens with the query already in the name field, so the click costs
 * what it looks like it costs.
 */
export function SuggestCourse({ query, className = '' }: { query: string; className?: string }) {
  const { t } = useT();
  return (
    <a
      href={suggestCourseUrl(query)}
      target="_blank"
      rel="noreferrer noopener"
      className={`inline-flex items-center gap-1 text-xs text-ink-dim underline decoration-line
                  underline-offset-2 transition-colors hover:text-accent ${className}`}
    >
      {t('ui.search.suggestCourse')}
      <Icon name="external" size={11} />
    </a>
  );
}

/** The rows themselves — the same list under a dropdown and inside the sheet. */
function Results({
  results,
  active,
  onActivate,
  onSelect,
}: {
  results: SearchResults;
  active: number;
  onActivate: (index: number) => void;
  onSelect: (entry: SearchEntry) => void;
}) {
  const { t } = useT();
  const catalog = useCatalog();

  if (results.empty) {
    /* Nothing was asked for yet, so «ничего не найдено» would be answering a
       question nobody put: the slice is empty, and that is what the columns
       behind the panel say too. */
    return (
      <div className="px-3 py-4 text-center text-sm text-ink-faint">
        <p>{results.suggested ? t('ui.graph.empty') : t('ui.search.empty')}</p>
        {/*
          Only when something was actually typed and missed. An empty slice is
          a filter to undo, not a hole in the catalogue — offering to file the
          missing course there would send people to write up courses that are
          already in it, two rows behind the panel.
        */}
        {results.suggested ? null : <SuggestCourse query={results.query} />}
      </div>
    );
  }

  return (
    <>
      {results.sections.map((section) => (
        <section key={section.type} className="mb-1 last:mb-0">
          <h3 className="mono-label px-3 pb-1 pt-2">
            {results.suggested
              ? t(`ui.search.suggest.${section.type}`)
              : t(`ui.search.section.${section.type}`)}
          </h3>
          {section.items.map(({ entry }) => {
            const index = results.flat.indexOf(entry);
            const isActive = index === active;
            return (
              <button
                key={`${entry.t}:${entry.id}`}
                type="button"
                role="option"
                aria-selected={isActive}
                onMouseEnter={() => onActivate(index)}
                onClick={() => onSelect(entry)}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm
                            ${isActive ? 'bg-surface-2 text-ink' : 'text-ink-dim'}`}
              >
                <SectionMark type={entry.t} />
                <span className="min-w-0 flex-1 truncate">
                  <MarkedText text={entry.n} query={results.query} />
                  {/* Why this row is here at all, when the query was somebody
                      else's name for the same course. The alias carries the
                      highlight, so the connection is made by the mark rather
                      than by a sentence. */}
                  {matchedAlias(entry, results.query) ? (
                    <span className="text-ink-faint">
                      {' · '}
                      <MarkedText
                        text={matchedAlias(entry, results.query)!}
                        query={results.query}
                      />
                    </span>
                  ) : null}
                </span>
                <Secondary entry={entry} catalog={catalog} />
              </button>
            );
          })}
        </section>
      ))}
    </>
  );
}

/**
 * What the default list leaves out is still findable, said in one line under it
 * rather than in three more sections — and read off the sections actually on
 * screen, so the sentence cannot drift from them: the map offers areas, courses
 * and universities, the columns offer the current slice, and each says what the
 * other one has.
 *
 * It sits outside the scroll area, or the line explaining what else there is
 * would itself be the thing you have to scroll to find.
 */
function Hint({ sections, className = '' }: { sections: SearchSection[]; className?: string }) {
  const { t } = useT();

  const shown = new Set(sections.map((section) => section.type));
  const rest = SEARCH_SECTION_ORDER.filter((type) => !shown.has(type)).map((type) =>
    t(`ui.search.kind.${type}`)
  );
  if (!rest.length) return null;

  const kinds =
    rest.length === 1
      ? rest[0]
      : `${rest.slice(0, -1).join(', ')} ${t('ui.common.and')} ${rest[rest.length - 1]}`;

  return (
    <p className={`shrink-0 border-t border-line px-3 py-2 text-[11px] text-ink-faint ${className}`}>
      {t('ui.search.hint', { kinds })}
    </p>
  );
}

function SectionMark({ type }: { type: SearchEntry['t'] }) {
  const color =
    type === 'd' ? 'bg-formal' : type === 'c' ? 'bg-accent' : type === 'p' ? 'bg-humanities' : 'bg-social';
  return <span className={`h-1.5 w-1.5 rounded-full ${color} opacity-70`} />;
}

function Secondary({
  entry,
  catalog,
}: {
  entry: SearchEntry;
  catalog: ReturnType<typeof useCatalog>;
}) {
  const { t, count } = useT();
  if (entry.t === 'c') {
    const course = catalog.courseById.get(entry.id);
    if (!course) return null;
    return (
      <span className="num shrink-0 text-xs text-ink-faint">
        {t('ui.course.level', { n: course.level + 1 })}
      </span>
    );
  }
  if (entry.t === 'd') {
    const domain = catalog.domainById.get(entry.id);
    if (!domain) return null;
    return <span className="num shrink-0 text-xs text-ink-faint">{count(domain.courseCount, 'course')}</span>;
  }
  if (entry.t === 'v') {
    const provider = catalog.providers[entry.id];
    if (!provider) return null;
    return (
      <span className="num shrink-0 text-xs text-ink-faint">
        {count(provider.playlistCount, 'playlist')}
      </span>
    );
  }
  return null;
}
