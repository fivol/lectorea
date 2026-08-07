import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { stageRank, type BuiltCourse, type BuiltDomain, type Stage } from '@shared/schema';
import { upstreamOf } from '@shared/graph';
import { loadCatalog, type Catalog } from './data';
import { I18nProvider, useT } from '@/i18n';
import { useProfile } from '@/store/profile';

const CatalogContext = createContext<Catalog | null>(null);

export function useCatalog(): Catalog {
  const catalog = useContext(CatalogContext);
  if (!catalog) throw new Error('useCatalog outside CatalogProvider');
  return catalog;
}

export function CatalogProvider({ children }: { children: ReactNode }) {
  const lang = useProfile((state) => state.profile.settings.lang);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    loadCatalog(lang)
      .then((value) => {
        if (!cancelled) setCatalog(value);
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause);
      });
    return () => {
      cancelled = true;
    };
  }, [lang]);

  if (error) return <FatalError error={error} />;
  if (!catalog) return <Booting />;

  return (
    <CatalogContext.Provider value={catalog}>
      <I18nProvider lang={lang} dict={catalog.dict}>
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }, (_, index) => (
              <div key={index} className="surface flex flex-col gap-2 p-4">
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
        <button className="btn mt-4" onClick={() => window.location.reload()}>
          Повторить
        </button>
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
 * Courses that survive the active domain, provider and stage filters.
 *
 * A filter means a filter: nothing from outside it is kept as context, not even
 * a prerequisite. Faded foreign cards scattered down the columns read as part of
 * the field you asked for while sitting several levels away from anything that
 * referred to them. Prerequisites are answered where the question is actually
 * asked — in the strip above the columns, and in the panel.
 */
export function useFilteredCourses(
  domainFilter: string[],
  providerFilter: string[],
  maxStage: Stage | null = null
): Set<string> {
  const catalog = useCatalog();

  return useMemo(() => {
    const providerCourses = providerFilter.length
      ? new Set(providerFilter.flatMap((id) => catalog.providers[id]?.courseIds ?? []))
      : null;

    const inDomain = (course: BuiltCourse): boolean =>
      !domainFilter.length || course.domains.some((d) => domainFilter.includes(d));

    return new Set(
      catalog.courses
        .filter((course) => !maxStage || stageRank(course.stage) <= stageRank(maxStage))
        .filter((course) => inDomain(course) && (!providerCourses || providerCourses.has(course.id)))
        .map((course) => course.id)
    );
  }, [catalog, domainFilter, providerFilter, maxStage]);
}
