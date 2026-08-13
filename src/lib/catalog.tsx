import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { stageRank, type BuiltCourse, type BuiltDomain, type Stage } from '@shared/schema';
import { upstreamOf } from '@shared/graph';
import { loadCatalog, loadLanguage, type Catalog, type Language } from './data';
import { I18nProvider, useT } from '@/i18n';
import { useProfile } from '@/store/profile';
import { Button } from '@/components/ui';

const CatalogContext = createContext<Catalog | null>(null);

export function useCatalog(): Catalog {
  const catalog = useContext(CatalogContext);
  if (!catalog) throw new Error('useCatalog outside CatalogProvider');
  return catalog;
}

export function CatalogProvider({ children }: { children: ReactNode }) {
  const lang = useProfile((state) => state.profile.settings.lang);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [language, setLanguage] = useState<Language | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadCatalog()
      .then((value) => {
        if (!cancelled) setCatalog(value);
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * The language follows the setting on its own, and the previous one stays on
   * screen until the new one lands. Switching language is a click in the
   * header, and a click in the header must not blank the page it is on.
   */
  const hasLanguage = useRef(false);

  useEffect(() => {
    let cancelled = false;
    loadLanguage(lang)
      .then((value) => {
        if (cancelled) return;
        hasLanguage.current = true;
        setLanguage(value);
      })
      .catch((cause: Error) => {
        // Only the very first language is fatal — without one there is nothing
        // to render but keys. A failed switch keeps the previous one, which is
        // a working page in the wrong language.
        if (!cancelled && !hasLanguage.current) setError(cause);
      });
    return () => {
      cancelled = true;
    };
  }, [lang]);

  /**
   * The page itself is part of the interface: the tab's name and the `lang` a
   * screen reader picks its voice from follow the dictionary that is actually
   * on screen, not the setting that may still be loading.
   */
  useEffect(() => {
    if (!language) return;
    document.documentElement.lang = language.lang;
    const title = language.dict['app.documentTitle'];
    if (title) document.title = title;
  }, [language]);

  /**
   * The index the screen searches is the two halves joined: courses and fields
   * in the language on screen, then everything YouTube named for us. Courses
   * first, so a tie between a course and a playlist reads the same way it did
   * when the index was one file.
   */
  const value = useMemo(
    () =>
      catalog && language ? { ...catalog, search: [...language.search, ...catalog.search] } : null,
    [catalog, language]
  );

  if (error) return <FatalError error={error} />;
  if (!value || !language) return <Booting />;

  return (
    <CatalogContext.Provider value={value}>
      <I18nProvider lang={language.lang} dict={language.dict}>
        {children}
      </I18nProvider>
    </CatalogContext.Provider>
  );
}

/**
 * The first screen, before its data exists.
 *
 * The shape of what is coming rather than a spinner in the middle of nothing:
 * the grid lands in the space already reserved for it, so the page does not
 * jump the moment the catalogue arrives.
 */
function Booting() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-8 sm:px-6" aria-busy="true">
      <span className="sr-only">Загрузка каталога…</span>
      {[0, 1].map((section) => (
        <div key={section} className="mb-10">
          <div className="skeleton mb-2 h-6 w-56 rounded" />
          <div className="skeleton mb-4 h-3 w-full max-w-2xl rounded" />
          <div className="grid grid-cols-1 gap-2.5 min-[480px]:grid-cols-2 sm:gap-3 md:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index} className="surface flex flex-col gap-2 p-3.5 sm:p-4">
                <div className="flex items-center gap-2.5">
                  <span className="skeleton h-[30px] w-[30px] shrink-0 rounded" />
                  <span className="skeleton h-4 flex-1 rounded" />
                </div>
                <span className="skeleton h-3 w-full rounded" />
                <span className="skeleton h-3 w-2/3 rounded" />
                <span className="skeleton mt-1 h-3 w-20 rounded" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function FatalError({ error }: { error: Error }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="surface max-w-md p-6 text-center">
        <p className="font-display text-lg">Не удалось загрузить данные</p>
        <p className="mt-2 text-sm text-ink-dim">
          Похоже, каталог ещё не собран. Запустите <code className="num">pnpm data:build</code>.
        </p>
        <p className="mt-3 text-xs text-ink-faint">{error.message}</p>
        <Button className="mt-4" onClick={() => window.location.reload()}>
          Повторить
        </Button>
      </div>
    </div>
  );
}

/* ─────────────────────────────  Graph queries  ─────────────────────────── */

/**
 * Everything that has to be studied before a course, in order.
 *
 * The build guarantees `level(dep) < level(course)`, so sorting the closure by
 * level *is* a correct study order — no topological sort on the client. `row`
 * only breaks ties, so the list does not reshuffle between renders.
 */
export function pathTo(catalog: Catalog, courseId: string): BuiltCourse[] {
  return [...upstreamOf(catalog.courseById, courseId)]
    .map((id) => catalog.courseById.get(id))
    .filter((course): course is BuiltCourse => Boolean(course))
    .sort((a, b) => a.level - b.level || a.row - b.row);
}

/**
 * The ancestors a filter hides that the chain cannot be read without.
 *
 * A filter drops one course out of the middle of a path and the path stops
 * being one: game theory needs probability, probability needs combinatorics,
 * and with probability filed under another field the two ends light up with
 * nothing between them — two unrelated groups of green cards and a gap where
 * the answer was. Those are borrowed back, and they arrive as guests, with the
 * tag naming the field they came from.
 *
 * Connectivity, not completeness. A hidden ancestor is borrowed only when
 * something already on the canvas stands behind it, so a branch that is hidden
 * from end to end has nothing to join up and stays out — which is what keeps a
 * filter a filter rather than an invitation to show the whole catalogue every
 * time a course is clicked.
 */
export function bridgingAncestors(
  catalog: Catalog,
  courseId: string,
  onCanvas: Set<string>
): Set<string> {
  // Prerequisites first: the build guarantees `level(dep) < level(course)`, so
  // one pass in column order settles every course after everything it needs.
  const ordered = [...upstreamOf(catalog.courseById, courseId)]
    .map((id) => catalog.courseById.get(id))
    .filter((course): course is BuiltCourse => Boolean(course))
    .sort((a, b) => a.level - b.level);

  const bridges = new Set<string>();
  // On the canvas already, or borrowed onto it just now — a run of hidden
  // ancestors is bridged along its whole length or not at all.
  const reached = new Set<string>();

  for (const course of ordered) {
    if (onCanvas.has(course.id)) reached.add(course.id);
    else if (course.deps.some((dep) => reached.has(dep))) {
      bridges.add(course.id);
      reached.add(course.id);
    }
  }

  return bridges;
}

export type Unlock = { id: string; behind: number };

/**
 * What a course opens up: the immediate dependants only, each carrying a count
 * of what sits further behind it. The full forward closure would be a wall of
 * chips nobody reads.
 */
export function unlocksOf(catalog: Catalog, courseId: string): Unlock[] {
  return (catalog.dependants.get(courseId) ?? [])
    .map((id) => ({ id, behind: catalog.behind.get(id) ?? 0 }))
    .sort((a, b) => b.behind - a.behind || a.id.localeCompare(b.id));
}

/* ─────────────────────────────  Derived lookups  ───────────────────────── */

/** Primary domain of a course — the first one, which gives the card its colour. */
export function usePrimaryDomain(course: BuiltCourse | undefined): BuiltDomain | undefined {
  const catalog = useCatalog();
  return course ? catalog.domainById.get(course.domains[0]) : undefined;
}

export function useCourseTitle(): (id: string) => string {
  const { t } = useT();
  return (id: string) => t(`course.${id}.title`);
}

export function useDomainTitle(): (id: string) => string {
  const { t } = useT();
  return (id: string) => t(`domain.${id}.title`);
}

/**
 * Courses that survive the active domain, provider, lecturer and stage filters.
 *
 * A filter means a filter: nothing from outside it is kept as context, not even
 * a prerequisite. Faded foreign cards scattered down the columns read as part of
 * the field you asked for while sitting several levels away from anything that
 * referred to them. Prerequisites are answered where the question is actually
 * asked — in the strip above the columns, and in the panel.
 *
 * The lecturer is answered from `lecturers.json` for the same reason the
 * provider is answered from `providers.json`: the playlists that would say so
 * live in 170 shards nobody is going to load to draw one screen. Naming one
 * used to leave the columns exactly as they were and empty out the list inside
 * every course they never taught — a filter with no visible effect but that.
 */
export function useFilteredCourses(
  domainFilter: string[],
  providerFilter: string[],
  lecturerFilter: string[],
  maxStage: Stage | null = null
): Set<string> {
  const catalog = useCatalog();

  return useMemo(() => {
    // Two sets, not one: each global filter is an OR inside itself and an AND
    // against the other — the same way `applyFilters` combines them over the
    // playlists once a course is open.
    const providerCourses = providerFilter.length
      ? new Set(providerFilter.flatMap((id) => catalog.providers[id]?.courseIds ?? []))
      : null;
    const lecturerCourses = lecturerFilter.length
      ? new Set(lecturerFilter.flatMap((name) => catalog.lecturers[name]?.courseIds ?? []))
      : null;

    const inDomain = (course: BuiltCourse): boolean =>
      !domainFilter.length || course.domains.some((d) => domainFilter.includes(d));

    return new Set(
      catalog.courses
        .filter((course) => !maxStage || stageRank(course.stage) <= stageRank(maxStage))
        .filter(
          (course) =>
            inDomain(course) &&
            (!providerCourses || providerCourses.has(course.id)) &&
            (!lecturerCourses || lecturerCourses.has(course.id))
        )
        .map((course) => course.id)
    );
  }, [catalog, domainFilter, providerFilter, lecturerFilter, maxStage]);
}
