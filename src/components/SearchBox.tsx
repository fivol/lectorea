import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import type { SearchEntry } from '@shared/schema';
import { SEARCH_SECTION_ORDER } from '@shared/search';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { useEscape, useIsMobile, useScrollLock } from '@/lib/hooks';
import { useCatalogParams } from '@/lib/url';
import type { SearchResults, SearchSection } from '@/lib/search';
import Icon from './Icon';
import MarkedText from './MarkedText';

type Props = {
  query: string;
  onQueryChange: (value: string) => void;
  results: SearchResults;
  /**
   * Floating pill on the map screen; inline field otherwise. `compact` is the
   * inline field on a wide screen and a search icon on a phone, where the field
   * would be a 160px slot in an already crowded toolbar.
   */
  variant?: 'floating' | 'inline' | 'compact';
  className?: string;
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
  const isMobile = useIsMobile();

  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  /*
   * On a phone the field becomes a button and the search becomes a screen: a
   * back arrow, the field, and the whole height for the list. A 160px input
   * wedged between two icons is a target you aim at, and what it drops down is
   * a list read through a letterbox — the pattern every phone already teaches
   * is to leave the toolbar behind entirely while searching.
   */
  const asSheet = variant === 'compact' && isMobile;
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

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  const select = useCallback(
    (entry: SearchEntry) => {
      switch (entry.t) {
        case 'd':
          navigate(`/courses?domain=${encodeURIComponent(entry.id)}`);
          setOpen(false);
          onQueryChange('');
          break;
        case 'c':
          navigate(`/courses/${encodeURIComponent(entry.id)}${params.search}`);
          setOpen(false);
          onQueryChange('');
          break;
        case 'p': {
          if (!entry.c) break;
          const search = new URLSearchParams(params.search.replace(/^\?/, ''));
          search.set('playlist', entry.id);
          navigate(`/courses/${encodeURIComponent(entry.c)}?${search.toString()}`);
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
      setSheet(false);
    },
    [navigate, onQueryChange, params]
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
        <button
          type="button"
          className="btn tap px-2"
          onClick={() => setSheet(true)}
          aria-label={t('ui.search.open')}
          aria-expanded={sheet}
        >
          <Icon name="search" />
        </button>

        {sheet
          ? createPortal(
              <div
                role="dialog"
                aria-modal="true"
                aria-label={t('ui.search.open')}
                className="fixed inset-0 z-50 flex animate-fade-in flex-col bg-surface"
              >
                <div className="flex shrink-0 items-center gap-2 border-b border-line px-2 py-2">
                  <button
                    type="button"
                    className="btn-ghost tap rounded p-2"
                    onClick={closeSheet}
                    aria-label={t('ui.common.back')}
                  >
                    <Icon name="arrow-left" />
                  </button>
                  <div className="flex min-w-0 flex-1 items-center gap-2 rounded-chip border
                                  border-line bg-surface-2 px-3 py-2">
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
                                 placeholder:text-ink-faint [&::-webkit-search-cancel-button]:hidden"
                    />
                    {query ? (
                      <button
                        type="button"
                        className="btn-ghost rounded p-1 text-ink-faint"
                        onClick={() => {
                          onQueryChange('');
                          inputRef.current?.focus();
                        }}
                        aria-label={t('ui.search.clear')}
                      >
                        <Icon name="close" size={16} />
                      </button>
                    ) : null}
                  </div>
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
      <div
        className={
          floating
            ? 'glass flex items-center gap-2 rounded-full border border-line px-4 py-2.5 shadow-[var(--shadow-pop)] backdrop-blur-xl'
            : 'flex items-center gap-2 rounded-chip border border-line bg-surface-2 px-3 py-1.5'
        }
      >
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
          className={`w-full bg-transparent text-ink outline-none placeholder:text-ink-faint
                      [&::-webkit-search-cancel-button]:hidden ${floating ? 'text-base' : 'text-sm'}`}
        />
        {query ? (
          <button
            type="button"
            className="btn-ghost rounded p-1 text-ink-faint hover:text-ink"
            onClick={() => {
              onQueryChange('');
              inputRef.current?.focus();
            }}
            aria-label={t('ui.search.clear')}
          >
            <Icon name="close" size={14} />
          </button>
        ) : (
          <kbd className="hidden rounded border border-line px-1.5 text-[11px] text-ink-faint sm:block">
            /
          </kbd>
        )}
      </div>

      {/*
        The panel opens on focus, not on the first keystroke. An empty dropdown
        under a field that says «Область, курс, вуз…» leaves the reader to take
        that on faith; the same three sections, filled with the largest of each,
        show what the catalogue is made of and that all three are searchable.
      */}
      {open ? (
        /*
          As wide as the field, and never narrower than a name: in the header of
          the columns screen the field is a 160px slot between two buttons, and
          a list scaled to it reads «Мат…  22 курса». So the panel hangs from the
          field's right edge and takes the width it needs — capped at 60vw,
          which is what keeps its left edge on screen on a phone.
        */
        <div
          className="glass-strong absolute right-0 top-[calc(100%+8px)] z-40 flex max-h-[70vh]
                     w-[min(60vw,340px)] min-w-full flex-col overflow-hidden rounded-pop
                     border border-line
                     origin-top animate-pop-in shadow-[var(--shadow-pop)] backdrop-blur-xl
                     sm:w-[340px]"
        >
          <div id="search-results" role="listbox" className="panel-scroll min-h-0 flex-1 p-2">
            {list}
          </div>

          {results.suggested && !results.empty ? <Hint sections={results.sections} /> : null}
        </div>
      ) : null}
    </div>
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
      <p className="px-3 py-4 text-center text-sm text-ink-faint">
        {results.suggested ? t('ui.graph.empty') : t('ui.search.empty')}
      </p>
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
                </span>
                <Secondary entry={entry} catalog={catalog} />
              </button>
            );
          })}
          {section.more > 0 ? (
            <p className="px-3 pb-1 text-xs text-ink-faint">
              {t('ui.search.more', { n: section.more })}
            </p>
          ) : null}
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
