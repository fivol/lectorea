import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '@/i18n';
import { placeBy, samePlace, type Placement } from '@/lib/popover';
import Icon from '@/components/Icon';
import { IconButton } from '@/components/ui';
import { FavoriteMark, StatusMark } from './CourseMarks';

const SEEN_KEY = 'lectorea.legend.seen.v1';

/** Roomy enough for the longest row, and never wider than a phone. */
const width = (): number => Math.min(360, window.innerWidth - 16);

/**
 * What everything on this screen means, in one place.
 *
 * The screen carries a lot of quiet signalling — a dimmed card, a star, a tick,
 * a grey dot next to 31 — and every one of those is a rule someone is expected
 * to have worked out. This is where the rules are written down.
 *
 * It opens itself once, on a first visit, and then never again unless asked:
 * a legend that reappears is an interruption, and one that never appears is a
 * secret.
 *
 * The phone shows a plain list instead of the graph, so half these rules do not
 * exist there — `variant` drops the ones the reader cannot see.
 */
export default function LegendPopover({ variant = 'columns' }: { variant?: 'columns' | 'list' }) {
  const { t } = useT();
  const columns = variant === 'columns';
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Partial<Placement>>({});

  useEffect(() => {
    try {
      if (localStorage.getItem(SEEN_KEY)) return;
      localStorage.setItem(SEEN_KEY, '1');
      setOpen(true);
    } catch {
      // Private mode, no storage: showing it every time beats never showing it.
    }
  }, []);

  // Before paint, so the panel never shows up in the top-left corner first.
  useLayoutEffect(() => {
    if (!open) return;
    const measure = (): void => {
      const trigger = boxRef.current?.getBoundingClientRect();
      if (!trigger) return;
      const next = placeBy(trigger, 'right', width());
      setBox((prev) => (samePlace(prev, next) ? prev : next));
    };
    measure();
    window.addEventListener('resize', measure);
    document.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      document.removeEventListener('scroll', measure, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const inside = (target: Node | null): boolean =>
      Boolean(boxRef.current?.contains(target) || popoverRef.current?.contains(target));
    const onPointerDown = (event: PointerEvent): void => {
      if (!inside(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span ref={boxRef} className="relative inline-flex">
      <button
        type="button"
        className="icon-btn h-6 w-6"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={t('ui.legend.title')}
        title={t('ui.legend.title')}
      >
        <Icon name="help" size={14} />
      </button>

      {/* Pinned to the viewport rather than to the button: the button sits at the
          right edge of its row, and a panel anchored under it left-aligned ran
          straight off a narrow screen. Clamped placement keeps it on screen. */}
      {open
        ? createPortal(
            <div
              ref={popoverRef}
              role="dialog"
              aria-label={t('ui.legend.title')}
              style={{
                ...box,
                width: 'min(360px, calc(100vw - 16px))',
                transformOrigin: box.bottom ? 'bottom' : 'top',
              }}
              className="panel-scroll fixed z-50 animate-pop-in rounded-pop border border-line
                         bg-surface p-4 text-caption shadow-[var(--shadow-pop)]"
            >
              <div className="mb-2 flex items-baseline gap-2">
                <h2 className="text-h3 text-ink">{t('ui.legend.title')}</h2>
                <IconButton
                  icon="close"
                  iconSize={13}
                  label={t('ui.common.close')}
                  className="ml-auto"
                  onClick={() => setOpen(false)}
                />
              </div>

              <dl className="space-y-2.5">
                {columns ? (
                  <Row mark={<span className="mono-label">{t('ui.column.level', { n: 4 })}</span>}>
                    {t('ui.legend.level')}
                  </Row>
                ) : (
                  <Row
                    mark={
                      <span className="text-[10px] uppercase tracking-wide text-ink-faint">
                        {t('ui.mobile.levelGroup', { n: 4 })}
                      </span>
                    }
                  >
                    {t('ui.legend.levelGroup')}
                  </Row>
                )}
                {columns ? (
                  <>
                    <Row
                      mark={
                        <span className="h-4 w-6 rounded border border-line bg-surface-2 opacity-45 grayscale" />
                      }
                    >
                      {t('ui.legend.dimmed')}
                    </Row>
                    <Row
                      mark={<span className="h-4 w-6 rounded border border-accent bg-accent-soft" />}
                    >
                      {t('ui.legend.inPath')}
                    </Row>
                    <Row
                      mark={
                        <span className="h-4 w-6 rounded border border-dashed border-ink-faint bg-surface" />
                      }
                    >
                      {t('ui.legend.guest')}
                    </Row>
                  </>
                ) : null}
                <Row mark={<StatusMark status="done" explain={false} />}>{t('ui.legend.done')}</Row>
                <Row mark={<StatusMark status="in_progress" explain={false} />}>
                  {t('ui.legend.inProgress')}
                </Row>
                <Row mark={<FavoriteMark explain={false} />}>{t('ui.legend.favorite')}</Row>
                {columns ? (
                  <>
                    <Row mark={<Icon name="bridge" size={14} className="text-ink-dim" />}>
                      {t('ui.map.bridgeHint')}
                    </Row>
                    <Row
                      mark={
                        <span className="flex items-center gap-0.5">
                          <span className="h-2 w-2 rounded-full bg-accent" />
                          <span className="h-2 w-2 rounded-full bg-warning" />
                          <span className="h-2 w-2 rounded-full bg-ink-faint" />
                        </span>
                      }
                    >
                      {t('ui.legend.quality')}
                    </Row>
                  </>
                ) : (
                  <Row mark={<span className="num text-xs text-ink-faint">12</span>}>
                    {t('ui.legend.playlistCount')}
                  </Row>
                )}
                <Row
                  mark={
                    <span className="text-[10px] text-ink-faint">{t('ui.course.noMaterials')}</span>
                  }
                >
                  {t('ui.legend.noMaterials')}
                </Row>
              </dl>
            </div>,
            document.body
          )
        : null}
    </span>
  );
}

function Row({ mark, children }: { mark: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <dt className="flex w-[86px] shrink-0 items-center justify-start pt-0.5">{mark}</dt>
      <dd className="min-w-0 flex-1 text-ink-dim">{children}</dd>
    </div>
  );
}
