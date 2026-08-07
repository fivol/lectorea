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

function Booting() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-ink-faint">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-accent" />
        <span className="text-sm">Загрузка каталога…</span>
      </div>
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
 * Courses that survive the active domain and provider filters.
 *
 * Neighbours one hop out are deliberately kept: they are dimmed by the caller,
 * not removed, so it stays visible that discrete maths came in from the maths
 * territory rather than appearing from nowhere.
 */
export function useFilteredCourses(
  domainFilter: string[],
  providerFilter: string[],
  maxStage: Stage | null = null
): { visible: Set<string>; dimmed: Set<string> } {
  const catalog = useCatalog();

  return useMemo(() => {
    const visible = new Set<string>();
    const dimmed = new Set<string>();

    /**
     * The stage cap is a hard cut, not a dimming: someone who says they are in
     * year 11 is saying a doctorate course is not context they want, so showing
     * it faded would be answering a question they did not ask.
     */
    const capped = maxStage
      ? catalog.courses.filter((course) => stageRank(course.stage) <= stageRank(maxStage))
      : catalog.courses;
    const withinCap = new Set(capped.map((course) => course.id));

    if (!domainFilter.length && !providerFilter.length) {
      for (const course of capped) visible.add(course.id);
      return { visible, dimmed };
    }

    const providerCourses = providerFilter.length
      ? new Set(
          providerFilter.flatMap((id) => catalog.providers[id]?.courseIds ?? [])
        )
      : null;

    const inDomain = (course: BuiltCourse): boolean =>
      !domainFilter.length || course.domains.some((d) => domainFilter.includes(d));

    const core = capped.filter(
      (course) => inDomain(course) && (!providerCourses || providerCourses.has(course.id))
    );
    for (const course of core) visible.add(course.id);

    // One hop of context around the selection, dimmed rather than hidden — and
    // never past the stage cap, which outranks the context.
    for (const course of core) {
      for (const neighbour of [...course.deps, ...course.soft, ...course.related]) {
        if (!visible.has(neighbour) && withinCap.has(neighbour)) dimmed.add(neighbour);
      }
      for (const dependant of catalog.dependants.get(course.id) ?? []) {
        if (!visible.has(dependant) && withinCap.has(dependant)) dimmed.add(dependant);
      }
    }

    return { visible, dimmed };
  }, [catalog, domainFilter, providerFilter, maxStage]);
}
