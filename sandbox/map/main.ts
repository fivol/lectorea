import { defaultConfig, generateMap, type MapConfig, type MapResult } from '../../shared/mapgen.js';
import type { Continent, Domain } from '../../shared/schema.js';

/**
 * The map sandbox: the generator with its knobs exposed, so the shapes can be
 * art-directed by eye instead of by editing constants and rebuilding.
 *
 * It is the same `generateMap` the pipeline calls. Whatever comes out of the
 * export buttons here is exactly what the build will produce from the config
 * shown in the panel — that is the whole point of it being one function.
 */

type Payload = {
  domains: Array<Domain & { courseCount: number }>;
  titles: Record<string, string>;
};

const data = (window as unknown as { __MAP_DATA__: Payload }).__MAP_DATA__;
const counts = new Map(data.domains.map((d) => [d.id, d.courseCount]));
const titleOf = (id: string) => data.titles[`domain.${id}.title`] ?? id;

const CONTINENT_LABEL: Record<Continent, string> = {
  formal: 'Формально-естественный',
  social: 'Социальный',
  humanities: 'Гуманитарный',
};

/* ─────────────────────────────────  State  ─────────────────────────────── */

/** Draft trades accuracy for a map that keeps up with a dragged slider. */
const DRAFT: Partial<MapConfig> = { hexR: 9, solverPasses: 26, restarts: 1 };
const FINAL: Partial<MapConfig> = { hexR: 5, solverPasses: 55, restarts: 4 };

let config: MapConfig = structuredClone(defaultConfig);
let quality: 'draft' | 'final' = 'final';
let showTemplate = false;
let hovered: string | null = null;
// First paint is draft and the final quality follows a tick later: the solver
// blocks for over a second at full resolution, and a blank page for that long
// reads as a page that failed to load.
let result: MapResult = generateMap(data.domains, counts, { ...config, ...DRAFT });

const effective = (): MapConfig => ({
  ...config,
  ...(quality === 'draft' ? DRAFT : FINAL),
});

/* ─────────────────────────────────  Controls  ──────────────────────────── */

type Slider = {
  key: keyof MapConfig | `character.${Continent}.aspect`;
  label: string;
  min: number;
  max: number;
  step: number;
  hint?: string;
};

type Group = { title: string; note?: string; sliders: Slider[] };

const GROUPS: Group[] = [
  {
    title: 'Композиция',
    note: 'Размер материка задан суммой курсов — меняется только форма и то, как они стоят.',
    sliders: [
      { key: 'landFraction', label: 'Доля суши', min: 0.25, max: 0.7, step: 0.01 },
      { key: 'strait', label: 'Ширина проливов', min: 10, max: 200, step: 2 },
      { key: 'coastComplexity', label: 'Изрезанность берега', min: 0, max: 1.4, step: 0.02 },
      { key: 'character.formal.aspect', label: 'Материк 1: ширина / высота', min: 0.3, max: 2.2, step: 0.02 },
      { key: 'character.social.aspect', label: 'Материк 2: ширина / высота', min: 0.2, max: 2.2, step: 0.02 },
      { key: 'character.humanities.aspect', label: 'Материк 3: ширина / высота', min: 0.3, max: 2.2, step: 0.02 },
    ],
  },
  {
    title: 'Формы областей',
    note: 'Вытянутость даёт каждой области свои пропорции, изгиб гнёт их все согласованно.',
    sliders: [
      { key: 'anisotropy', label: 'Вытянутость', min: 0, max: 1, step: 0.02 },
      { key: 'warpAmount', label: 'Изгиб', min: 0, max: 90, step: 1 },
      { key: 'warpScale', label: 'Масштаб изгиба', min: 80, max: 700, step: 10 },
    ],
  },
  {
    title: 'Границы',
    note: 'Сглаживание идёт по общему графу, поэтому щель между соседями появиться не может.',
    sliders: [
      { key: 'smoothIterations', label: 'Сглаживание', min: 0, max: 40, step: 1 },
      { key: 'smoothStrength', label: 'Сила сглаживания', min: 0.05, max: 0.95, step: 0.05 },
      { key: 'coastNoise', label: 'Шум берега', min: 0, max: 12, step: 0.2 },
      { key: 'inlandNoise', label: 'Шум границ', min: 0, max: 8, step: 0.2 },
      { key: 'subdivisions', label: 'Дробление рёбер', min: 0, max: 3, step: 1 },
    ],
  },
  {
    title: 'Точность',
    note: 'Ниже 40 проходов солвера мелкие области не добирают положенную площадь.',
    sliders: [
      { key: 'hexR', label: 'Шаг сетки (px)', min: 3, max: 14, step: 1 },
      { key: 'solverPasses', label: 'Проходы солвера', min: 8, max: 120, step: 1 },
      { key: 'solverRate', label: 'Демпфирование', min: 0.15, max: 0.9, step: 0.05 },
      { key: 'restarts', label: 'Попыток раскладки', min: 1, max: 10, step: 1 },
    ],
  },
];

const readKnob = (key: Slider['key']): number => {
  if (typeof key === 'string' && key.startsWith('character.')) {
    const [, continent] = key.split('.') as [string, Continent];
    return config.character[continent].aspect;
  }
  return config[key as keyof MapConfig] as number;
};

const writeKnob = (key: Slider['key'], value: number): void => {
  if (typeof key === 'string' && key.startsWith('character.')) {
    const [, continent] = key.split('.') as [string, Continent];
    config.character[continent] = { ...config.character[continent], aspect: value };
    return;
  }
  (config as unknown as Record<string, number>)[key as string] = value;
};

/* ───────────────────────────────  Rendering  ───────────────────────────── */

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  children: Array<Node | string> = []
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value as string;
    else (node as unknown as Record<string, unknown>)[key] = value;
  }
  for (const child of children) node.append(child);
  return node;
};

const app = document.getElementById('app')!;
const panel = el('aside', { class: 'panel' });
const stage = el('main', { class: 'stage' });
app.append(panel, stage);

function buildPanel(): void {
  panel.replaceChildren();

  panel.append(
    el('div', { class: 'brand' }, [
      el('h1', { textContent: 'Карта областей' }),
      el('p', {
        textContent:
          'Тот же генератор, что и в сборке. Площади заданы числом курсов и не настраиваются — крутится только форма.',
      }),
    ])
  );

  /* Variant stepper — a map is a seed, so browsing variants is stepping it. */
  const seedValue = el('span', { class: 'seed', textContent: String(config.seed) });
  const step = (delta: number) => () => {
    config.seed = Math.max(0, config.seed + delta);
    seedValue.textContent = String(config.seed);
    regenerate();
  };
  panel.append(
    el('div', { class: 'row variant' }, [
      el('label', { textContent: 'Вариант' }),
      el('div', { class: 'stepper' }, [
        el('button', { textContent: '◀', onclick: step(-1), title: 'Предыдущий' }),
        seedValue,
        el('button', { textContent: '▶', onclick: step(1), title: 'Следующий' }),
      ]),
    ])
  );

  const qualityRow = el('div', { class: 'row' }, [el('label', { textContent: 'Качество' })]);
  const select = el('select', {
    onchange: (event: Event) => {
      quality = (event.target as HTMLSelectElement).value as 'draft' | 'final';
      regenerate();
    },
  });
  select.append(
    el('option', { value: 'final', textContent: 'Финальное (сетка 5px)' }),
    el('option', { value: 'draft', textContent: 'Черновое (быстро)' })
  );
  select.value = quality;
  qualityRow.append(select);
  panel.append(qualityRow);

  for (const group of GROUPS) {
    const section = el('section', {}, [el('h2', { textContent: group.title })]);
    if (group.note) section.append(el('p', { class: 'note', textContent: group.note }));

    for (const slider of group.sliders) {
      const output = el('output', { textContent: format(readKnob(slider.key)) });
      const input = el('input', {
        type: 'range',
        min: String(slider.min),
        max: String(slider.max),
        step: String(slider.step),
        value: String(readKnob(slider.key)),
      });
      // Dragging renders draft quality; letting go renders what is selected.
      input.addEventListener('input', () => {
        writeKnob(slider.key, Number(input.value));
        output.textContent = format(Number(input.value));
        regenerate('draft');
      });
      input.addEventListener('change', () => regenerate());

      section.append(
        el('div', { class: 'knob' }, [
          el('div', { class: 'knob-head' }, [
            el('label', { textContent: slider.label }),
            output,
          ]),
          input,
        ])
      );
    }
    panel.append(section);
  }

  panel.append(
    el('section', { class: 'exports' }, [
      el('h2', { textContent: 'Экспорт' }),
      el('div', { class: 'buttons' }, [
        el('button', { textContent: 'SVG (вектор)', onclick: () => download('map.svg', svgString(false), 'image/svg+xml') }),
        el('button', { textContent: 'PNG (превью)', onclick: () => exportRaster('map.png', false) }),
        el('button', { class: 'accent', textContent: 'Шаблон для нейросети (JPG)', onclick: () => exportRaster('map-template.jpg', true) }),
        el('button', { textContent: 'Конфиг (JSON)', onclick: () => download('map.config.json', JSON.stringify(config, null, 2), 'application/json') }),
      ]),
      el('label', { class: 'toggle' }, [
        (() => {
          const box = el('input', { type: 'checkbox', checked: showTemplate });
          box.addEventListener('change', () => {
            showTemplate = box.checked;
            paint();
          });
          return box;
        })(),
        document.createTextNode(' Показывать шаблон вместо карты'),
      ]),
      el('button', {
        class: 'ghost',
        textContent: 'Сбросить настройки',
        onclick: () => {
          config = structuredClone(defaultConfig);
          buildPanel();
          regenerate();
        },
      }),
    ])
  );
}

const format = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(2);

/* ─────────────────────────────────  Stage  ─────────────────────────────── */

const metrics = el('div', { class: 'metrics' });
const canvasWrap = el('div', { class: 'canvas' });
const labelLayer = el('div', { class: 'labels' });
stage.append(metrics, canvasWrap);
canvasWrap.append(labelLayer);

/**
 * The territories, the coast and its extrusion. Labels are deliberately not
 * here: they live in the DOM layer above, where text wrapping, icons and
 * `text-overflow` are free instead of being reimplemented in SVG.
 */
function svgMarkup(template: boolean): string {
  const { width, height, viewBox } = result;

  if (template) {
    // The conditioning image for the image model: land white, ocean black,
    // coast heavy, internal divisions faint. The model is being told where the
    // land is — the borders it invents inside are not used for anything, since
    // the vector supplies every boundary the site actually hit-tests.
    const coast = result.coasts.map((c) => `<path d="${c.path}" fill="#ffffff"/>`).join('');
    const divisions = result.territories
      .map((t) => `<path d="${t.path}" fill="none" stroke="#9a9a9a" stroke-width="1.6"/>`)
      .join('');
    const outline = result.coasts
      .map((c) => `<path d="${c.path}" fill="none" stroke="#000000" stroke-width="5"/>`)
      .join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}">
<rect width="100%" height="100%" fill="#000000"/>${coast}${divisions}${outline}</svg>`;
  }

  const shadow = result.coasts
    .map((c) => `<path d="${c.path}" fill="#1d4258" opacity="0.35" transform="translate(0 11)"/>`)
    .join('');

  const fills = result.territories
    .map((t) => {
      const active = hovered === t.id;
      return (
        `<path id="shape-${t.id}" data-domain="${t.id}" d="${t.path}" ` +
        `fill="${t.colour}" fill-opacity="${active ? 0.95 : 0.68}" ` +
        `stroke="#fdfbf4" stroke-width="${active ? 3 : 1.6}" stroke-linejoin="round"/>`
      );
    })
    .join('');

  const coast = result.coasts
    .map((c) => `<path d="${c.path}" fill="none" stroke="#fdfbf4" stroke-width="4.5" stroke-linejoin="round"/>`)
    .join('');

  // Dependencies that cross the ocean — where the reference map draws bridges.
  const links = result.links
    .map(
      (l) =>
        `<path d="M${l.a.x.toFixed(1)} ${l.a.y.toFixed(1)}L${l.b.x.toFixed(1)} ${l.b.y.toFixed(1)}" ` +
        `stroke="#f0f6f8" stroke-width="2" stroke-dasharray="7 6" opacity="0.5" fill="none"/>`
    )
    .join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet">
<rect width="100%" height="100%" fill="#cfe6f0"/>${shadow}${links}${fills}${coast}</svg>`;
}

/** The export carries labels as real text, since nothing renders the DOM layer. */
function svgString(template: boolean): string {
  const base = svgMarkup(template);
  if (template) return base;

  const labels = placedLabels()
    .map((entry) => {
      const title = titleOf(entry.id).toUpperCase();
      return (
        `<text x="${entry.x.toFixed(1)}" y="${entry.y.toFixed(1)}" text-anchor="middle" ` +
        `font-family="Helvetica,Arial,sans-serif" font-weight="700" font-size="${entry.size.toFixed(1)}" ` +
        `fill="#1d2c3a" paint-order="stroke" stroke="#ffffff" stroke-width="${(entry.size * 0.25).toFixed(1)}" ` +
        `stroke-linejoin="round" stroke-opacity="0.85">${escapeXml(title)}</text>`
      );
    })
    .join('');

  return base.replace('</svg>', `${labels}</svg>`);
}

const escapeXml = (text: string): string =>
  text.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Which labels fit, and at what size.
 *
 * The pole of inaccessibility gives each territory the radius of the largest
 * circle inside it, so the type size follows from the shape rather than from
 * the course count. Anything that still collides with an already-placed label
 * is dropped — a territory that cannot hold its name shows it on hover, which
 * is what the map does anyway.
 */
type Placed = { id: string; x: number; y: number; size: number; w: number; h: number };

function placedLabels(): Placed[] {
  const placed: Placed[] = [];
  const ordered = [...result.territories].sort((a, b) => b.room - a.room);

  for (const territory of ordered) {
    const title = titleOf(territory.id).toUpperCase();
    let size = Math.max(8, Math.min(22, territory.room * 0.42));
    let width = title.length * size * 0.56;

    // Shrink to fit the inscribed circle before giving up on it.
    const room = territory.room * 2.1;
    if (width > room) {
      size = Math.max(7, (size * room) / width);
      width = title.length * size * 0.56;
    }
    if (size < 8.5 && hovered !== territory.id) continue;

    const box = {
      id: territory.id,
      x: territory.label.x,
      y: territory.label.y,
      size,
      w: width,
      h: size * 1.25,
    };
    const clash = placed.some(
      (other) =>
        Math.abs(other.x - box.x) < (other.w + box.w) / 2 &&
        Math.abs(other.y - box.y) < (other.h + box.h) / 2
    );
    if (clash && hovered !== territory.id) continue;
    placed.push(box);
  }
  return placed;
}

/** Territory paths by domain id, so hovering can touch two attributes instead
 *  of rebuilding the document — a rebuild loses the pointer and flickers. */
const paths = new Map<string, SVGPathElement>();

function paint(): void {
  canvasWrap.style.setProperty('--ratio', String(result.width / result.height));
  canvasWrap.querySelector('svg')?.remove();
  canvasWrap.insertAdjacentHTML('afterbegin', svgMarkup(showTemplate));

  const svg = canvasWrap.querySelector('svg')!;
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.addEventListener('pointerleave', () => setHovered(null));

  paths.clear();
  for (const path of Array.from(svg.querySelectorAll<SVGPathElement>('path[data-domain]'))) {
    const id = path.dataset.domain!;
    paths.set(id, path);
    path.style.cursor = 'pointer';
    path.addEventListener('pointerenter', () => setHovered(id));
  }

  labelLayer.style.display = showTemplate ? 'none' : 'block';
  paintLabels();
}

function setHovered(id: string | null): void {
  if (hovered === id) return;
  hovered = id;
  for (const [domainId, path] of paths) {
    const active = domainId === hovered;
    path.setAttribute('fill-opacity', active ? '0.95' : '0.68');
    path.setAttribute('stroke-width', active ? '3' : '1.6');
  }
  paintLabels();
}

/**
 * Labels are positioned as a share of the map, but sized in real pixels from
 * the rendered width — a viewport unit would drift as soon as the panel or the
 * window changed the stage's width.
 */
function paintLabels(): void {
  labelLayer.replaceChildren();
  if (showTemplate) return;

  const pixelsPerUnit = (canvasWrap.clientWidth || result.width) / result.width;

  for (const entry of placedLabels()) {
    const territory = result.territories.find((t) => t.id === entry.id)!;
    const node = el('div', { class: `label${hovered === entry.id ? ' is-active' : ''}` }, [
      el('span', { class: 'label-title', textContent: titleOf(entry.id) }),
      el('span', { class: 'label-meta', textContent: `${counts.get(entry.id) ?? 0} курс.` }),
    ]);
    node.style.left = `${(entry.x / result.width) * 100}%`;
    node.style.top = `${(entry.y / result.height) * 100}%`;
    node.style.fontSize = `${Math.max(6, entry.size * pixelsPerUnit).toFixed(2)}px`;
    node.title = `${titleOf(entry.id)} · ${CONTINENT_LABEL[territory.continent]}`;
    labelLayer.append(node);
  }
}

new ResizeObserver(() => paintLabels()).observe(canvasWrap);

function paintMetrics(): void {
  const m = result.metrics;
  const chip = (label: string, value: string, tone = '') =>
    el('div', { class: `chip ${tone}` }, [
      el('span', { class: 'chip-label', textContent: label }),
      el('span', { class: 'chip-value', textContent: value }),
    ]);

  metrics.replaceChildren(
    chip('Ошибка площади', `${(m.areaError * 100).toFixed(1)}%`, m.areaError < 0.05 ? 'good' : 'warn'),
    chip('Худшая', `${(m.worstAreaError * 100).toFixed(1)}%`, m.worstAreaError < 0.15 ? 'good' : 'warn'),
    chip('Связи графа', `${(m.adjacencyRate * 100).toFixed(0)}%`),
    chip('Ячеек', String(m.cells)),
    chip('Время', `${m.elapsedMs} мс`),
    chip('Областей', String(result.territories.length))
  );
}

/* ────────────────────────────────  Plumbing  ───────────────────────────── */

let pending = 0;

function regenerate(force?: 'draft'): void {
  window.clearTimeout(pending);
  pending = window.setTimeout(() => {
    const overrides = force === 'draft' ? { ...config, ...DRAFT } : effective();
    result = generateMap(data.domains, counts, overrides);
    paint();
    paintMetrics();
  }, 40);
}

function download(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = el('a', { href: url, download: name });
  link.click();
  URL.revokeObjectURL(url);
}

/** Rasterises the current SVG at 2× through a canvas. */
async function exportRaster(name: string, template: boolean): Promise<void> {
  const markup = svgString(template);
  const scale = 2;
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));

  try {
    const image = new Image();
    image.decoding = 'sync';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('svg did not load'));
      image.src = url;
    });

    const canvas = document.createElement('canvas');
    canvas.width = result.width * scale;
    canvas.height = result.height * scale;
    const context = canvas.getContext('2d')!;
    // JPEG has no transparency; without a ground the template comes out with a
    // black background either way, but the preview would go dark too.
    context.fillStyle = template ? '#000000' : '#cfe6f0';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const type = name.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, type, 0.94)
    );
    if (!blob) return;
    const out = URL.createObjectURL(blob);
    const link = el('a', { href: out, download: name });
    link.click();
    URL.revokeObjectURL(out);
  } finally {
    URL.revokeObjectURL(url);
  }
}

buildPanel();
paint();
paintMetrics();
regenerate();
