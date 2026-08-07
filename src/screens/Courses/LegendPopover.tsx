import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '@/i18n';
import Icon from '@/components/Icon';

const SEEN_KEY = 'lectorea.legend.seen.v1';

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
 */
export default function LegendPopover() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(SEEN_KEY)) return;
      localStorage.setItem(SEEN_KEY, '1');
      setOpen(true);
    } catch {
      // Private mode, no storage: showing it every time beats never showing it.
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
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
        className="btn-ghost rounded-full p-0.5"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={t('ui.legend.title')}
        title={t('ui.legend.title')}
      >
        <Icon name="help" size={14} />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={t('ui.legend.title')}
          className="absolute left-0 top-[calc(100%+8px)] z-50 w-[min(360px,80vw)] origin-top
                     animate-pop-in rounded-pop border border-line bg-surface p-4
                     text-caption shadow-[var(--shadow-pop)]"
        >
          <div className="mb-2 flex items-baseline gap-2">
            <h2 className="text-h3 text-ink">{t('ui.legend.title')}</h2>
            <button
              type="button"
              className="btn-ghost ml-auto rounded p-1"
              onClick={() => setOpen(false)}
              aria-label={t('ui.common.close')}
            >
              <Icon name="close" size={13} />
            </button>
          </div>

          <dl className="space-y-2.5">
            <Row mark={<span className="mono-label">{t('ui.column.level', { n: 4 })}</span>}>
              {t('ui.legend.level')}
            </Row>
            <Row
              mark={
                <span className="h-4 w-6 rounded border border-line bg-surface-2 opacity-45 grayscale" />
              }
            >
              {t('ui.legend.dimmed')}
            </Row>
            <Row mark={<span className="h-4 w-6 rounded border border-accent bg-accent-soft" />}>
              {t('ui.legend.inPath')}
            </Row>
            <Row
              mark={
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent text-canvas">
                  <Icon name="check" size={10} />
                </span>
              }
            >
              {t('ui.legend.done')}
            </Row>
            <Row mark={<Icon name="star-filled" size={14} className="text-warning" />}>
              {t('ui.legend.favorite')}
            </Row>
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
            <Row mark={<span className="text-[10px] text-ink-faint">{t('ui.course.noMaterials')}</span>}>
              {t('ui.legend.noMaterials')}
            </Row>
          </dl>
        </div>
      ) : null}
    </span>
  );
}

function Row({ mark, children }: { mark: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <dt className="flex w-16 shrink-0 items-center justify-start pt-0.5">{mark}</dt>
      <dd className="min-w-0 flex-1 text-ink-dim">{children}</dd>
    </div>
  );
}
