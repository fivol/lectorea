import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SearchEntry } from '@shared/schema';
import { SEARCH_SECTION_ORDER } from '@shared/search';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { useCatalogParams } from '@/lib/url';
import type { SearchResults, SearchSection } from '@/lib/search';
import Icon from './Icon';
import MarkedText from './MarkedText';

type Props = {
  query: string;
  onQueryChange: (value: string) => void;
  results: SearchResults;
  /** Floating pill on the map screen; inline field in the graph top bar. */
  variant?: 'floating' | 'inline';
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
  const catalog = useCatalog();
  const navigate = useNavigate();
  const params = useCatalogParams();

  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

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
        inputRef.current?.focus();
        setOpen(true);
      }
      // Second Escape — the one pressed when the field is no longer focused —
      // clears the query. The first only drops focus and keeps the highlight.
      if (event.key === 'Escape' && !typing && query) {
        onQueryChange('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [query, onQueryChange]);

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
    },
    [navigate, onQueryChange, params]
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
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
      // Drops focus but keeps the highlight — that is the point of two steps.
      event.preventDefault();
      setOpen(false);
      inputRef.current?.blur();
    }
  };

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
          onKeyDown={onKeyDown}
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
            {results.empty ? (
              /* Nothing was asked for yet, so «ничего не найдено» would be
                 answering a question nobody put: the slice is empty, and that
                 is what the columns behind the panel say too. */
              <p className="px-3 py-4 text-center text-sm text-ink-faint">
                {results.suggested ? t('ui.graph.empty') : t('ui.search.empty')}
              </p>
            ) : (
              results.sections.map((section) => (
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
                        onMouseEnter={() => setActive(index)}
                        onClick={() => select(entry)}
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
              ))
            )}
          </div>

          {results.suggested && !results.empty ? <Hint sections={results.sections} /> : null}
        </div>
      ) : null}
    </div>
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
function Hint({ sections }: { sections: SearchSection[] }) {
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
    <p className="shrink-0 border-t border-line px-3 py-2 text-[11px] text-ink-faint">
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
