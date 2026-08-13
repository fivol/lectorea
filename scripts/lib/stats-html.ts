import {
  fmt,
  type Bar,
  type Fact,
  type Point,
  type Stats,
  type Tone,
} from './stats.js';

/**
 * The dashboard as one self-contained HTML page.
 *
 * No script and no external request: every chart is CSS boxes or one inline
 * SVG path, so the file can be opened straight from disk, kept in a tab while a
 * crawl runs, or mailed to someone without a checkout. Hover comes from `title`
 * attributes rather than from a tooltip library — native, and it survives the
 * page being saved somewhere else.
 *
 * Chart rules follow one line each: a single series is a single hue, the three
 * continents keep their own identity hues, and status colours are reserved for
 * things that are actually good or bad. Text never wears the data colour.
 */

/* ──────────────────────────────  Primitives  ───────────────────────────── */

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const TONE_VARS: Record<Tone, string> = {
  series: 'var(--s1)',
  formal: 'var(--s1)',
  social: 'var(--s2)',
  humanities: 'var(--s3)',
  accent: 'var(--accent)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  muted: 'var(--ink-faint)',
};

function toneVar(tone: Tone | undefined): string {
  return TONE_VARS[tone ?? 'series'];
}

/** A share as Russian text — the decimal comma, so it sits with «23 689» rather than against it. */
function pct(share: number): string {
  return `${(share * 100).toFixed(1).replace('.', ',')}%`;
}

/** `14 дней`, `2 дня`, `1 день` — the window is computed, so its caption has to be too. */
function days(count: number): string {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${count} дней`;
  if (mod10 === 1) return `${count} день`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} дня`;
  return `${count} дней`;
}

function card(title: string, note: string, body: string, wide = false): string {
  return `<section class="card${wide ? ' wide' : ''}">
  <h3>${esc(title)}</h3>
  ${note ? `<p class="note">${esc(note)}</p>` : ''}
  ${body}
</section>`;
}

function facts(items: Fact[]): string {
  return `<div class="facts">${items
    .map(
      (item) => `<div class="fact"${item.hint ? ` title="${esc(item.hint)}"` : ''}>
      <b>${esc(item.value)}</b>
      <span>${esc(item.label)}</span>
      ${item.hint ? `<i>${esc(item.hint)}</i>` : ''}
    </div>`
    )
    .join('')}</div>`;
}

/**
 * Horizontal magnitude bars. `unit: '%'` switches on the track behind the bar —
 * a share has a meaningful full length, a count does not.
 */
function bars(items: Bar[], options: { unit?: string; max?: number } = {}): string {
  if (!items.length) return `<p class="empty">нет данных</p>`;
  const max = options.max ?? Math.max(...items.map((item) => item.value), 1);
  return `<div class="bars">${items
    .map((item) => {
      const width = Math.max((item.value / max) * 100, item.value > 0 ? 1.5 : 0);
      const hover = `${item.label} · ${fmt(item.value)}${options.unit ?? ''}${
        item.note ? ` · ${item.note}` : ''
      }`;
      return `<div class="bar" title="${esc(hover)}">
      <span class="bar-label">${esc(item.label)}</span>
      <span class="bar-track${options.unit === '%' ? ' has-track' : ''}"><i style="width:${width.toFixed(
        1
      )}%;background:${toneVar(item.tone)}"></i></span>
      <span class="bar-value">${fmt(item.value)}${esc(options.unit ?? '')}</span>
      ${item.note ? `<span class="bar-note">${esc(item.note)}</span>` : '<span></span>'}
    </div>`;
    })
    .join('')}</div>`;
}

/** Vertical columns for a small distribution: every cap carries its own value. */
function columns(
  points: Point[],
  options: { tone?: Tone; unit?: string; caption?: string } = {}
): string {
  if (!points.length) return `<p class="empty">нет данных</p>`;
  const max = Math.max(...points.map((point) => point.value), 1);
  const caps = points.length <= 14;
  return `<div class="cols">${points
    .map((point) => {
      const height = (point.value / max) * 100;
      return `<div class="col" title="${esc(
        `${options.caption ?? ''}${point.label} · ${fmt(point.value)}${options.unit ?? ''}`
      )}">
      <b class="cap">${caps || point.value === max ? fmt(point.value) : ''}</b>
      <span class="stack"><i style="height:${height.toFixed(1)}%;background:${toneVar(
        options.tone
      )}"></i></span>
      <span class="tick">${esc(point.label)}</span>
    </div>`;
    })
    .join('')}</div>`;
}

const DAY_LABEL = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' });
const DAY_ONLY = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' });

function dayLabel(iso: string): string {
  return DAY_LABEL.format(new Date(`${iso}T00:00:00Z`));
}

/** A long daily series: one thin column a day, gaps included as zero. */
function dense(points: Point[], options: { tone?: Tone; unit?: string } = {}): string {
  if (!points.length) return `<p class="empty">нет данных</p>`;
  const max = Math.max(...points.map((point) => point.value), 1);
  const total = points.reduce((sum, point) => sum + point.value, 0);
  const middle = points[Math.floor(points.length / 2)];
  return `<div class="series">
  <div class="series-head">
    <span>макс ${fmt(max)}${esc(options.unit ?? '')}</span>
    <span>всего за период ${fmt(total)}${esc(options.unit ?? '')}</span>
  </div>
  <div class="series-plot">${points
    .map((point) => {
      // A day with nothing in it draws nothing. A one-pixel stub for every
      // empty day would run along the baseline and read as a dashed rule.
      const height = point.value ? Math.max((point.value / max) * 100, 2) : 0;
      return `<i style="height:${height.toFixed(1)}%;background:${toneVar(
        options.tone
      )}" title="${esc(
        `${dayLabel(point.label)} · ${fmt(point.value)}${options.unit ?? ''}`
      )}"></i>`;
    })
    .join('')}</div>
  <div class="series-axis">
    <span>${esc(dayLabel(points[0].label))}</span>
    <span>${esc(dayLabel(middle.label))}</span>
    <span>сегодня</span>
  </div>
</div>`;
}

/**
 * A cumulative curve. The SVG is stretched to the container with
 * `preserveAspectRatio="none"`, so nothing inside it may be text — the labels
 * are HTML around it, and the stroke keeps its width through
 * `vector-effect`. Invisible per-day rectangles carry the hover.
 */
function area(points: Point[], options: { unit?: string } = {}): string {
  if (points.length < 2) return `<p class="empty">нет данных</p>`;
  const W = 600;
  const H = 120;
  const max = Math.max(...points.map((point) => point.value), 1);
  const step = W / (points.length - 1);
  const at = (point: Point, index: number): [number, number] => [
    index * step,
    H - (point.value / max) * (H - 4) - 2,
  ];

  const line = points
    .map((point, index) => {
      const [x, y] = at(point, index);
      return `${index ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
  const fill = `${line} L${W} ${H} L0 ${H} Z`;
  const last = points[points.length - 1];

  return `<div class="area">
  <div class="series-head">
    <span>макс ${fmt(max)}${esc(options.unit ?? '')}</span>
    <span>сейчас ${fmt(last.value)}${esc(options.unit ?? '')}</span>
  </div>
  <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
       aria-label="Накопительная кривая, ${points.length} дней, максимум ${fmt(max)}">
    <path class="area-fill" d="${fill}"/>
    <path class="area-line" d="${line}" vector-effect="non-scaling-stroke"/>
    ${points
      .map(
        (point, index) =>
          `<rect x="${(index * step - step / 2).toFixed(1)}" y="0" width="${step.toFixed(
            1
          )}" height="${H}" fill="transparent"><title>${esc(
            `${dayLabel(point.label)} · ${fmt(point.value)}${options.unit ?? ''}`
          )}</title></rect>`
      )
      .join('')}
  </svg>
  <div class="series-axis">
    <span>${esc(dayLabel(points[0].label))}</span>
    <span></span>
    <span>сегодня</span>
  </div>
</div>`;
}

function table(headers: string[], rows: string[][], meters?: number[]): string {
  return `<table>
  <thead><tr>${headers
    .map((header, index) => `<th${index ? ' class="num"' : ''}>${esc(header)}</th>`)
    .join('')}</tr></thead>
  <tbody>${rows
    .map(
      (row, rowIndex) => `<tr>${row
        .map((cell, index) => {
          if (index === 0) {
            const meter =
              meters && meters[rowIndex] !== undefined
                ? `<span class="row-meter"><i style="width:${(meters[rowIndex] * 100).toFixed(
                    0
                  )}%"></i></span>`
                : '';
            return `<td>${esc(cell)}${meter}</td>`;
          }
          return `<td class="num">${esc(cell)}</td>`;
        })
        .join('')}</tr>`
    )
    .join('')}</tbody>
</table>`;
}

/* ────────────────────────────────  Styles  ─────────────────────────────── */

/**
 * The product's own tokens, restated here because this page is one file and
 * cannot import `src/index.css`. The three continent hues are the identity
 * palette; they are validated to stay apart under colour-vision deficiency in
 * both themes, which is why the same three values serve light and dark.
 */
const CSS = String.raw`
:root {
  color-scheme: light dark;
  --canvas: #F6F8FB;
  --surface: #FFFFFF;
  --surface-2: #EEF2F7;
  --line: #E2E8F0;
  --ink: #1E293B;
  --ink-dim: #64748B;
  --ink-faint: #94A3B8;
  --accent: #22A06B;
  --warning: #D97706;
  --danger: #DC2626;
  --s1: #3B82F6;
  --s2: #CE7A2E;
  --s3: #9B5DE0;
  --shadow: 0 1px 2px rgb(15 23 42 / .06), 0 1px 3px rgb(15 23 42 / .04);
}
@media (prefers-color-scheme: dark) {
  :root {
    --canvas: #0B0F17;
    --surface: #111726;
    --surface-2: #1A2233;
    --line: #243044;
    --ink: #E6EBF2;
    --ink-dim: #8B98AC;
    --ink-faint: #5B6B82;
    --accent: #34C98A;
    --warning: #F59E0B;
    --danger: #F87171;
    --shadow: none;
  }
}

* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--canvas);
  color: var(--ink);
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.num, .cap, .tick, .bar-value, td.num, th.num, .fact b {
  font-variant-numeric: tabular-nums;
}

.wrap { max-width: 1240px; margin: 0 auto; padding: 28px 20px 64px; }

/* ── header ── */
header.page { margin-bottom: 22px; }
header.page h1 { margin: 0 0 6px; font-size: 24px; letter-spacing: -.01em; }
header.page p { margin: 0; color: var(--ink-dim); font-size: 13px; }
.badges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.badge {
  font-size: 11.5px;
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--surface);
  border: 1px solid var(--line);
  color: var(--ink-dim);
}
.badge.warn { border-color: var(--warning); color: var(--warning); }

nav.toc {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 10px 0;
  margin-bottom: 18px;
  background: var(--canvas);
  border-bottom: 1px solid var(--line);
}
nav.toc a {
  font-size: 12.5px;
  color: var(--ink-dim);
  text-decoration: none;
  padding: 4px 10px;
  border-radius: 999px;
}
nav.toc a:hover { background: var(--surface-2); color: var(--ink); }

h2.band {
  margin: 34px 0 14px;
  font-size: 12px;
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--ink-faint);
}
h2.band:first-of-type { margin-top: 0; }

/* ── grid of cards ── */
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
  gap: 14px;
  align-items: start;
}
.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 16px;
  box-shadow: var(--shadow);
  min-width: 0;
}
.card.wide { grid-column: 1 / -1; }
.card h3 { margin: 0 0 2px; font-size: 15px; }
.card .note { margin: 0 0 12px; font-size: 12px; color: var(--ink-dim); }
.card h3 + .bars, .card h3 + .cols, .card h3 + table { margin-top: 12px; }
.empty { margin: 0; color: var(--ink-faint); font-size: 12.5px; }

/* ── hero ── */
.hero {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 22px;
}
.hero-figure { min-width: 190px; }
.hero-figure b { display: block; font-size: 52px; font-weight: 600; line-height: 1; }
.hero-figure span { display: block; margin-top: 6px; color: var(--ink-dim); font-size: 13px; }
.hero-meter { flex: 1; min-width: 220px; }
.meter {
  height: 12px;
  border-radius: 6px;
  background: var(--surface-2);
  overflow: hidden;
}
.meter i { display: block; height: 100%; background: var(--accent); border-radius: 0 6px 6px 0; }
.meter-legend {
  display: flex;
  justify-content: space-between;
  margin-top: 7px;
  font-size: 12px;
  color: var(--ink-dim);
}

/* ── facts ── */
.facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 12px;
}
.fact { min-width: 0; }
.fact b { display: block; font-size: 22px; font-weight: 600; line-height: 1.2; }
.fact span { display: block; font-size: 12.5px; color: var(--ink-dim); }
.fact i { display: block; font-size: 11px; color: var(--ink-faint); font-style: normal; }

/* ── horizontal bars ── */
.bars { display: grid; gap: 7px; }
.bar {
  display: grid;
  grid-template-columns: minmax(0, 11rem) minmax(60px, 1fr) auto minmax(0, auto);
  align-items: center;
  gap: 10px;
}
.bar-label {
  font-size: 12.5px;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bar-track { display: block; height: 10px; border-radius: 5px; }
.bar-track.has-track { background: var(--surface-2); }
.bar-track i { display: block; height: 100%; border-radius: 0 4px 4px 0; min-width: 2px; }
.bar-value { font-size: 12.5px; color: var(--ink); }
.bar-note { font-size: 11.5px; color: var(--ink-faint); white-space: nowrap; }

/* ── columns ── */
.cols { display: flex; align-items: flex-end; gap: 4px; }
.col { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 3px; }
.cap { font-size: 11px; color: var(--ink-dim); font-weight: 500; min-height: 15px; }
.stack { display: flex; align-items: flex-end; width: 100%; height: 120px; }
.stack i {
  display: block;
  width: 100%;
  max-width: 24px;
  margin-inline: auto;
  min-height: 2px;
  border-radius: 4px 4px 0 0;
}
.tick {
  font-size: 11px;
  color: var(--ink-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

/* ── dense daily series ── */
.series-head, .series-axis {
  display: flex;
  justify-content: space-between;
  font-size: 11.5px;
  color: var(--ink-faint);
}
.series-head { margin-bottom: 8px; }
.series-axis { margin-top: 7px; }
.series-plot {
  display: flex;
  align-items: flex-end;
  gap: 1px;
  height: 96px;
  border-bottom: 1px solid var(--line);
}
.series-plot i { flex: 1; min-width: 1px; border-radius: 2px 2px 0 0; }

/* ── area ── */
.area svg { display: block; width: 100%; height: 120px; }
.area-fill { fill: var(--s1); opacity: .12; }
.area-line { fill: none; stroke: var(--s1); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }

/* ── tables ── */
table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
th {
  text-align: left;
  font-size: 11px;
  letter-spacing: .05em;
  text-transform: uppercase;
  color: var(--ink-faint);
  font-weight: 600;
  padding: 0 8px 7px 0;
}
th.num, td.num { text-align: right; padding-right: 0; padding-left: 14px; }
td { padding: 6px 8px 6px 0; border-top: 1px solid var(--line); vertical-align: middle; }
td:first-child { min-width: 0; }
.row-meter {
  display: block;
  height: 4px;
  margin-top: 4px;
  border-radius: 2px;
  background: var(--surface-2);
  max-width: 220px;
}
.row-meter i { display: block; height: 100%; border-radius: 2px; background: var(--accent); }
.scroll { overflow-x: auto; }
.chain { margin: 0; font-size: 12.5px; color: var(--ink-dim); line-height: 1.8; }
.chain b { color: var(--ink); font-weight: 600; }
footer.page { margin-top: 40px; font-size: 12px; color: var(--ink-faint); }
footer.page code { font-size: 11.5px; }
`;

/* ─────────────────────────────────  Page  ──────────────────────────────── */

const STAMP = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

function ageText(hours: number): string {
  if (hours < 1) return 'меньше часа назад';
  if (hours < 24) return `${Math.round(hours)} ч назад`;
  return `${Math.round(hours / 24)} дн назад`;
}

export function renderPage(stats: Stats): string {
  const sections: string[] = [];
  const toc: Array<[string, string]> = [];

  /* Overview ------------------------------------------------------------- */

  const catalog = stats.catalog;
  toc.push(['#overview', 'Обзор']);

  const heroCard = catalog
    ? card(
        'Покрытие каталога',
        'доля курсов, у которых есть хотя бы одна запись',
        `<div class="hero">
      <div class="hero-figure">
        <b>${pct(catalog.hero.share)}</b>
        <span>${fmt(catalog.hero.covered)} курсов из ${fmt(catalog.hero.total)}</span>
      </div>
      <div class="hero-meter">
        <div class="meter" title="${esc(
          `${fmt(catalog.hero.covered)} из ${fmt(catalog.hero.total)}`
        )}"><i style="width:${(catalog.hero.share * 100).toFixed(1)}%"></i></div>
        <div class="meter-legend"><span>с материалом</span><span>${fmt(
          catalog.hero.total - catalog.hero.covered
        )} пустых</span></div>
      </div>
    </div>`,
        true
      )
    : card(
        'Каталог не собран',
        '',
        `<p class="empty">Запустите <code>pnpm data:build</code> — страница читает <code>public/data</code>.</p>`,
        true
      );

  sections.push(`<h2 class="band" id="overview">Обзор</h2>
<div class="grid">
  ${heroCard}
  ${catalog ? card('Ключевые показатели', 'на момент последней сборки', facts(catalog.tiles), true) : ''}
</div>`);

  /* What is left --------------------------------------------------------- */

  if (stats.crawl) {
    const forecast = stats.crawl.forecast;
    toc.push(['#todo', 'Что осталось']);
    const share = catalog ? catalog.hero.share : 0;
    sections.push(`<h2 class="band" id="todo">Что осталось</h2>
<div class="grid">
  ${card(
    'Оценка оставшейся работы',
    'квота и время просмотра — разные валюты, поэтому и считаются отдельно',
    facts(forecast.facts),
    true
  )}
  ${card(
    'Куда уйдёт квота, если выгрести очередь',
    'задания на плейлисты, уже отмеченные «не курс», оплачивать незачем — их лучше снять с очереди',
    bars(
      [
        { label: 'полезно', value: forecast.useful.units, tone: 'accent' },
        { label: 'впустую', value: forecast.wasted.units, tone: 'danger' },
      ],
      { unit: ' ед.' }
    ) +
      `<p class="note" style="margin:12px 0 0">За день воркер тратит не больше ${fmt(
        forecast.ceiling
      )} единиц, так что полезной работы тут ${
        forecast.useful.days <= 1 ? 'меньше чем на день' : `на ${forecast.useful.days} дн`
      }.</p>`
  )}
  ${card(
    'Плановые проходы',
    'метаданные и проверка доступности идут не очередью, а окном — им остался срок, а не квота',
    `<div class="scroll">${table(
      ['Проход', 'Ждёт сейчас', 'Следующий'],
      forecast.scheduled.map((row) => [
        row.label,
        row.due ? fmt(row.due) : '—',
        row.due ? 'уже пора' : row.when ? DAY_ONLY.format(new Date(row.when)) : '—',
      ])
    )}</div>`
  )}
  ${card(
    'Пустые курсы: чем закрываются',
    'что уже лежит в кеше и ждёт решения, и чего нет нигде',
    bars([
      {
        label: 'есть кандидаты',
        value: forecast.fillable.courses,
        note: `${forecast.fillable.candidates} плейлистов`,
        tone: 'accent',
      },
      { label: 'нужны новые каналы', value: forecast.unsourced, tone: 'warning' },
    ])
  )}
  ${card(
    'Покрытие: сейчас и после просмотра очереди',
    'просмотр очереди не стоит ни одной единицы квоты',
    `<div class="hero">
      <div class="hero-meter">
        <div class="meter" title="сейчас"><i style="width:${(share * 100).toFixed(1)}%"></i></div>
        <div class="meter-legend"><span>сейчас</span><span>${pct(share)}</span></div>
        <div class="meter" style="margin-top:14px" title="после просмотра очереди"><i style="width:${(
          forecast.projectedCoverage * 100
        ).toFixed(1)}%;background:var(--s1)"></i></div>
        <div class="meter-legend"><span>после просмотра очереди</span><span>${pct(
          forecast.projectedCoverage
        )}</span></div>
      </div>
    </div>`
  )}
</div>`);
  }

  /* Coverage ------------------------------------------------------------- */

  if (catalog) {
    toc.push(['#coverage', 'Покрытие']);
    const domainRows = catalog.coverage.byDomain.map((domain) => [
      domain.title,
      fmt(domain.courses),
      fmt(domain.covered),
      `${domain.courses ? Math.round((domain.covered / domain.courses) * 100) : 0}%`,
      fmt(domain.playlists),
      fmt(domain.hours),
    ]);
    const domainMeters = catalog.coverage.byDomain.map((domain) =>
      domain.courses ? domain.covered / domain.courses : 0
    );

    sections.push(`<h2 class="band" id="coverage">Покрытие</h2>
<div class="grid">
  ${card(
    'Сколько записей у курса',
    'распределение курсов по числу плейлистов',
    columns(
      catalog.coverage.byBucket.map((bar) => ({ label: bar.label, value: bar.value })),
      { caption: 'плейлистов: ', unit: ' курсов' }
    )
  )}
  ${card(
    'По континентам',
    'доля курсов с материалом',
    bars(catalog.coverage.byContinent, { unit: '%', max: 100 })
  )}
  ${card(
    'По ступеням',
    'доля курсов с материалом на каждой ступени образования',
    bars(catalog.coverage.byStage, { unit: '%', max: 100 })
  )}
  ${card(
    'Самые дорогие дыры',
    'пустые курсы, отсортированные по числу курсов, которые за ними стоят',
    `<div class="scroll">${table(
      ['Курс', 'Блокирует', 'Колонка', 'Ступень'],
      catalog.coverage.gaps.map((gap) => [
        `${gap.title} · ${gap.domain}`,
        fmt(gap.blocks),
        String(gap.level),
        gap.stage,
      ])
    )}</div>`
  )}
  ${card(
    'Покрытие по областям',
    'курсы, у которых есть записи, по каждой области знания',
    `<div class="scroll">${table(
      ['Область', 'Курсов', 'С материалом', 'Доля', 'Плейлистов', 'Часов'],
      domainRows,
      domainMeters
    )}</div>`,
    true
  )}
</div>`);
  }

  /* Graph ---------------------------------------------------------------- */

  if (catalog) {
    toc.push(['#graph', 'Граф']);
    sections.push(`<h2 class="band" id="graph">Граф курсов</h2>
<div class="grid">
  ${card('Структура графа', 'связи между курсами, как их видит сборка', facts(catalog.graph.facts), true)}
  ${card(
    'Курсы по колонкам',
    'колонка — длина самой длинной цепочки предпосылок, заканчивающейся курсом',
    columns(catalog.graph.byLevel, { caption: 'сложность ', unit: ' курсов' })
  )}
  ${card('Курсы по ступеням', 'где курс обычно встречают в образовании', bars(catalog.graph.byStage))}
  ${card('Курсы по областям', 'по первой, определяющей области', bars(catalog.graph.byDomain))}
  ${card(
    'Что открывает больше всего',
    'сколько курсов становятся доступны после этого — транзитивно',
    `<div class="scroll">${table(
      ['Курс', 'Открывает', 'Напрямую', 'Плейлистов'],
      catalog.graph.hubs.map((hub) => [
        hub.title,
        fmt(hub.behind),
        fmt(hub.direct),
        fmt(hub.playlists),
      ])
    )}</div>`
  )}
  ${card(
    'Самая длинная цепочка',
    'глубина каталога как маршрут, а не как число',
    `<p class="chain">${catalog.graph.longestChain
      .map((title, index) =>
        index === catalog.graph.longestChain.length - 1
          ? `<b>${esc(title)}</b>`
          : `${esc(title)} →`
      )
      .join(' ')}</p>`,
    true
  )}
</div>`);
  }

  /* Playlists ------------------------------------------------------------ */

  if (catalog) {
    toc.push(['#playlists', 'Плейлисты']);
    sections.push(`<h2 class="band" id="playlists">Плейлисты</h2>
<div class="grid">
  ${card('Материал каталога', 'всё, что опубликовано в public/data', facts(catalog.playlists.facts), true)}
  ${card('Языки', '', bars(catalog.playlists.byLang))}
  ${card('Тип записи', '', bars(catalog.playlists.byKind))}
  ${card('Полнота курса', '', bars(catalog.playlists.byCompleteness))}
  ${card('Длина лекции', 'по медианной длительности видео', bars(catalog.playlists.byLength))}
  ${card('Тип провайдера', '', bars(catalog.playlists.byProviderType))}
  ${card('Статус', 'что показано в списке — первый подошедший сверху вниз', bars(catalog.playlists.byStatus))}
  ${card(
    'Рейтинг',
    'отклик и досматриваемость, приведённые к отклонению от медианы каталога',
    columns(catalog.playlists.byScore, { caption: 'рейтинг от ', unit: ' плейлистов' })
  )}
  ${card(
    'Год записи',
    'когда снят материал, по дате первого видео',
    columns(catalog.playlists.byYear, { caption: '', unit: ' плейлистов' }),
    true
  )}
  ${card('Провайдеры', 'сколько плейлистов даёт каждый', bars(catalog.playlists.topProviders))}
  ${card('Преподаватели', 'у кого больше всего записей', bars(catalog.playlists.topLecturers))}
</div>`);
  }

  /* Time series ---------------------------------------------------------- */

  const crawl = stats.crawl;
  if (crawl) {
    toc.push(['#dynamics', 'Динамика']);
    // The window follows the data — see `windowDays` — so the captions read it
    // back off the series rather than repeating a number that has moved.
    const window = days(crawl.matchesByDay.length);
    sections.push(`<h2 class="band" id="dynamics">Динамика</h2>
<div class="grid">
  ${card(
    'Разметка растёт',
    `сколько плейлистов привязано к курсам, накопительно за ${window}`,
    area(crawl.matchesCumulative)
  )}
  ${card(
    'Решений о привязке в день',
    `за ${window}`,
    dense(crawl.matchesByDay, { tone: 'accent' })
  )}
  ${card(
    'Расход квоты',
    'единиц YouTube Data API в сутки, потолок — 10 000',
    dense(crawl.quotaByDay, { tone: 'warning' })
  )}
  ${card('Проверено плейлистов в день', 'обход и обновление метаданных', dense(crawl.checksByDay))}
  ${card(
    'Когда сняты лекции',
    'видео в кеше по году публикации на YouTube',
    columns(crawl.videosByYear, { unit: ' видео' }),
    true
  )}
</div>`);
  }

  /* Pipeline ------------------------------------------------------------- */

  if (crawl) {
    toc.push(['#pipeline', 'Обход']);
    sections.push(`<h2 class="band" id="pipeline">Обход и очередь</h2>
<div class="grid">
  ${card('Кеш обхода', 'data/cache.db — рабочая память между запусками', facts(crawl.facts), true)}
  ${card(
    'Воронка',
    'от найденного плейлиста до строки в каталоге',
    bars(crawl.funnel, { max: crawl.funnel[0]?.value }) +
      `<p class="note" style="margin:12px 0 0">Последний шаг может быть выше предыдущего:
       в каталог попадают ещё и привязки из overrides.yaml, которых кеш не видел.</p>`
  )}
  ${card('Состояние разметки', 'что происходит с найденными плейлистами', bars(crawl.queue))}
  ${card('Свежесть данных', 'когда плейлист проверяли в последний раз', bars(crawl.freshness))}
  ${card('Чем размечено', 'метод, которым получена привязка', bars(crawl.matchMethods))}
  ${card(
    'Уверенность матчинга',
    `порог публикации — 0,75; ниже него нужен просмотр вручную`,
    columns(crawl.confidence, { caption: 'от ', unit: ' привязок' })
  )}
  ${card('Каналы', 'сколько плейлистов даёт каждый канал', bars(crawl.topChannels))}
  ${card(
    'Очередь задач',
    'таблица jobs: что сделано, что ждёт, что упало',
    `<div class="scroll">${table(
      ['Тип', 'Готово', 'Ждёт', 'Ошибки', 'Прочее'],
      crawl.jobs.map((job) => [
        job.type,
        fmt(job.done),
        fmt(job.pending),
        fmt(job.error),
        fmt(job.other),
      ])
    )}</div>`
  )}
</div>`);
  }

  /* Curation ------------------------------------------------------------- */

  toc.push(['#curation', 'Разметка']);
  sections.push(`<h2 class="band" id="curation">Ручная разметка</h2>
<div class="grid">
  ${card('Что решено руками', 'data/overrides.yaml и data/i18n — то, что коммитится', facts(stats.curation.facts), true)}
  ${card('Решения о плейлистах', '', bars(stats.curation.overrides))}
</div>`);

  /* Document ------------------------------------------------------------- */

  const badges = [
    catalog
      ? `<span class="badge">каталог собран ${esc(ageText(catalog.ageHours))}</span>`
      : '<span class="badge warn">public/data не собран</span>',
    crawl
      ? `<span class="badge">cache.db ${crawl.dbSizeMb.toFixed(0)} МБ</span>`
      : '<span class="badge warn">cache.db нет</span>',
    ...stats.notes.map((note) => `<span class="badge warn">${esc(note)}</span>`),
  ].join('');

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Статистика — Lectorea</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
<header class="page">
  <h1>Статистика Lectorea</h1>
  <p>Собрано ${esc(STAMP.format(new Date(stats.generatedAt)))}${
    catalog ? ` · каталог версии ${esc(catalog.meta.version)}` : ''
  }</p>
  <div class="badges">${badges}</div>
</header>
<nav class="toc">${toc
    .map(([href, title]) => `<a href="${href}">${esc(title)}</a>`)
    .join('')}</nav>
${sections.join('\n')}
<footer class="page">
  Страница собирается командой <code>pnpm stats</code> и никуда не публикуется:
  цифры про обход берутся из <code>data/cache.db</code>, которого нет в репозитории.
</footer>
</div>
</body>
</html>
`;
}
