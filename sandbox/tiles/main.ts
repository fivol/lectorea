import {
  assemblies,
  assemblyBox,
  assemblyMarkup,
  buildManifest,
  centreOf,
  EDGE_NAMES,
  edgeCorners,
  findTile,
  GROUPS,
  gridMarkup,
  hexClipDefs,
  HEX_W,
  placedSeams,
  placementMarkup,
  round,
  sortStack,
  spriteSvg,
  stackMarkup,
  tally,
  tiles,
  tileSvg,
  type Assembly,
  type Meets,
  type Placement,
  type Tile,
  type TileGroup,
} from '../../shared/tiles/index.js';

/**
 * The collection, laid out for looking at.
 *
 * It draws from the same registry the exporter reads, so nothing here is a
 * picture of the collection — it *is* the collection, at whatever size the
 * slider says. Which is also the claim being checked: a tile that only works at
 * one size is a bug, and the slider is how it shows up.
 */

/* ─────────────────────────────────  State  ─────────────────────────────── */

type Background = 'paper' | 'land' | 'water' | 'ink';

const state = {
  size: 76,
  variant: 0,
  seed: 1,
  grid: false,
  seams: false,
  under: true,
  background: 'paper' as Background,
  groups: new Set<TileGroup>(GROUPS.map((group) => group.id)),
};

const seedOf = () => `v${state.seed}`;

/**
 * Every plate on the page is its own <svg>, and they all share one id space:
 * without a fresh clip id per picture, `url(#…)` would resolve to whichever
 * plate rendered first and the rest would come out unclipped.
 */
let clips = 0;
const options = () => ({ seed: seedOf(), clipId: `hex-clip-${++clips}` });

/* ──────────────────────────────────  DOM  ──────────────────────────────── */

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: Array<Node | string> = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'textContent') node.textContent = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

/** An SVG document dropped straight into the page. */
function figure(markup: string, className = 'plate'): HTMLElement {
  const box = el('div', { class: className });
  box.innerHTML = markup;
  return box;
}

const SEAM_COLOUR: Record<Meets, string> = {
  water: '#3aa0d8',
  land: '#8fbf5a',
  shore: '#e0a34a',
  channel: '#4fc3d9',
  ridge: '#b07be0',
  canopy: '#4fbf85',
};

const SEAM_LABEL: Record<Meets, string> = {
  water: 'вода',
  land: 'суша',
  shore: 'берег',
  channel: 'русло',
  ridge: 'гребень',
  canopy: 'лес',
};

/** The seams of a placed tile, drawn along the hex edges they occupy. */
function seamMarkup(tile: Tile, placement: Omit<Placement, 'tile'>, at: { x: number; y: number }, size: number): string {
  if (!state.seams) return '';
  return placedSeams(tile, placement)
    .flatMap((seam) =>
      seam.edges.map((edge) => {
        const [a, b] = edgeCorners(edge, size * 0.88);
        return (
          `<path d="M${round(at.x + a.x)} ${round(at.y + a.y)}L${round(at.x + b.x)} ${round(at.y + b.y)}" ` +
          `stroke="${SEAM_COLOUR[seam.meets]}" stroke-width="${round(size * 0.07)}" ` +
          `stroke-linecap="round" fill="none" opacity="0.9"/>`
        );
      })
    )
    .join('');
}

/* ────────────────────────────────  Gallery  ────────────────────────────── */

/** One tile in a hex, on the ground it is meant to be laid on. */
function tilePlate(tile: Tile, variant: number, size: number): string {
  const under = state.under && tile.on ? findTile(tile.on) : undefined;
  const width = (HEX_W + tile.bleed * 2) * size;
  const height = (2 + tile.bleed * 2) * size;
  const at = { x: 0, y: 0 };

  const draw = options();
  const layers = [
    under ? placementMarkup(under, { variant }, at, size, draw) : '',
    placementMarkup(tile, { variant }, at, size, draw),
    state.grid ? gridMarkup([{ q: 0, r: 0, stack: [] }], size) : '',
    seamMarkup(tile, { variant }, at, size),
  ];

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${round(-width / 2)} ${round(-height / 2)} ` +
    `${round(width)} ${round(height)}" width="${round(width)}" height="${round(height)}">` +
    hexClipDefs(draw.clipId) +
    layers.join('') +
    `</svg>`
  );
}

const KIND_LABEL = { solo: 'самостоятельная', part: 'часть' } as const;
const LAYER_LABEL = {
  ground: 'основа',
  surface: 'поверхность',
  relief: 'рельеф',
  overlay: 'метка',
} as const;

function tileCard(tile: Tile): HTMLElement {
  const variant = state.variant % tile.variants;

  const badges = el('div', { class: 'badges' }, [
    el('span', { class: `badge ${tile.kind}`, textContent: KIND_LABEL[tile.kind] }),
    el('span', { class: 'badge', textContent: LAYER_LABEL[tile.layer] }),
    ...(tile.upright ? [el('span', { class: 'badge warn', textContent: 'не вращать' })] : []),
    ...(tile.clip ? [] : [el('span', { class: 'badge', textContent: 'за клетку' })]),
  ]);

  const facts: Array<Node | string> = [el('p', { class: 'use', textContent: tile.use })];

  for (const seam of tile.seams) {
    facts.push(
      el('p', { class: 'seam' }, [
        el('i', { style: `background:${SEAM_COLOUR[seam.meets]}` }),
        `${SEAM_LABEL[seam.meets]} · грани ${seam.edges.map((edge) => `${edge} ${EDGE_NAMES[edge]}`).join(', ')}`,
      ])
    );
  }

  for (const [name, option] of Object.entries(tile.options)) {
    facts.push(
      el('p', { class: 'opt', textContent: `${name}: ${option.values.join(' / ')} — ${option.note}` })
    );
  }

  if (tile.on) {
    const ground = findTile(tile.on);
    facts.push(el('p', { class: 'opt', textContent: `кладётся на: ${ground?.title ?? tile.on}` }));
  }

  const save = el('button', { class: 'save', title: 'Скачать SVG', textContent: '⤓' });
  save.addEventListener('click', () =>
    download(`${tile.id}-${variant}.svg`, tileSvg(tile, { variant }, { seed: seedOf(), size: 160 }), 'image/svg+xml')
  );

  const plate = figure(tilePlate(tile, variant, state.size));
  plate.addEventListener('click', () => {
    state.variant = (state.variant + 1) % 6;
    paint();
  });
  plate.title = 'Клик — следующий вариант';

  return el('article', { class: 'card' }, [
    plate,
    el('header', {}, [
      el('h3', { textContent: tile.title }),
      el('code', { textContent: tile.id }),
      save,
    ]),
    badges,
    el('div', { class: 'facts' }, facts),
  ]);
}

/* ────────────────────────────────  Objects  ────────────────────────────── */

function assemblyCard(assembly: Assembly): HTMLElement {
  const size = state.size;
  const box = assemblyBox(assembly, findTile, size);
  const overlay =
    (state.grid ? gridMarkup(assembly.cells, size) : '') +
    (state.seams
      ? assembly.cells
          .flatMap((cell) => {
            const centre = centreOf(cell.q, cell.r, size);
            return cell.stack.map((placement) => {
              const tile = findTile(placement.tile);
              return tile ? seamMarkup(tile, placement, centre, size) : '';
            });
          })
          .join('')
      : '');

  const draw = options();
  const markup =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${round(box.x)} ${round(box.y)} ` +
    `${round(box.width)} ${round(box.height)}" width="${round(box.width)}" height="${round(box.height)}">` +
    hexClipDefs(draw.clipId) +
    assemblyMarkup(assembly, findTile, size, draw) +
    overlay +
    `</svg>`;

  // The recipe, in the same words it is stored in — the point of the section is
  // that the object is a list of cells, not a picture.
  const recipe = el('table', { class: 'recipe' }, [
    el('tbody', {}, assembly.cells.map((cell) =>
      el('tr', {}, [
        el('td', { class: 'axial', textContent: `${cell.q},${cell.r}` }),
        el(
          'td',
          {},
          sortStack(cell.stack, findTile).map((placement) => {
            const bits = [findTile(placement.tile)?.title ?? placement.tile];
            if (placement.rotate) bits.push(`↻${placement.rotate}`);
            if (placement.flip) bits.push('⇋');
            if (placement.opts) bits.push(Object.values(placement.opts).join('/'));
            return el('span', { class: 'chip-mini', textContent: bits.join(' ') });
          })
        ),
      ])
    )),
  ]);

  const save = el('button', { class: 'save', title: 'Скачать SVG', textContent: '⤓' });
  save.addEventListener('click', () => {
    const big = assemblyBox(assembly, findTile, 96);
    download(
      `${assembly.id}.svg`,
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${round(big.x)} ${round(big.y)} ` +
        `${round(big.width)} ${round(big.height)}">${hexClipDefs()}` +
        assemblyMarkup(assembly, findTile, 96, { seed: seedOf() }) +
        `</svg>`,
      'image/svg+xml'
    );
  });

  return el('article', { class: 'card wide' }, [
    figure(markup, 'plate stage-plate'),
    el('header', {}, [
      el('h3', { textContent: assembly.title }),
      el('code', { textContent: `${assembly.cells.length} кл.` }),
      save,
    ]),
    el('p', { class: 'use', textContent: assembly.note }),
    el('details', {}, [el('summary', { textContent: 'Из чего собрано' }), recipe]),
  ]);
}

/* ─────────────────────────────────  Stack  ─────────────────────────────── */

/**
 * One cell built up a layer at a time. The whole idea in four pictures: nothing
 * in the collection draws a finished cell, they are stacked into one.
 */
const STACK_DEMO: Placement[] = [
  { tile: 'grass-plain' },
  { tile: 'grass-tufts' },
  { tile: 'flowers' },
  { tile: 'hill' },
  { tile: 'tree' },
];

function stackStrip(): HTMLElement {
  const size = Math.min(state.size, 96);
  const steps = STACK_DEMO.map((_, index) => {
    const stack = STACK_DEMO.slice(0, index + 1);
    const bleed = Math.max(0, ...stack.map((placement) => findTile(placement.tile)?.bleed ?? 0));
    const width = (HEX_W + bleed * 2) * size;
    const height = (2 + bleed * 2) * size;
    const draw = options();
    const markup =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${round(-width / 2)} ${round(-height / 2)} ` +
      `${round(width)} ${round(height)}" width="${round(width)}" height="${round(height)}">` +
      hexClipDefs(draw.clipId) +
      stackMarkup(stack, findTile, { x: 0, y: 0 }, size, draw) +
      `</svg>`;
    const tile = findTile(STACK_DEMO[index].tile);
    return el('figure', { class: 'step' }, [
      figure(markup),
      el('figcaption', { textContent: `+ ${tile?.title ?? STACK_DEMO[index].tile}` }),
    ]);
  });
  return el('div', { class: 'strip' }, steps);
}

/* ─────────────────────────────────  Panel  ─────────────────────────────── */

function buildPanel(): HTMLElement {
  const panel = el('aside', { class: 'panel' });
  const counts = tally();

  panel.append(
    el('div', { class: 'brand' }, [
      el('h1', { textContent: 'Коллекция плиток' }),
      el('p', {
        textContent:
          `${counts.tiles} плиток · ${counts.variants} вариантов · ${counts.assemblies} объекта. ` +
          'Всё нарисовано в единичном гексагоне и масштабируется, а не подбирается по размеру.',
      }),
    ])
  );

  const sizes = el('section', {}, [
    el('h2', { textContent: 'Размер' }),
    el('p', {
      class: 'note',
      textContent: 'Один и тот же файл на любую клетку — толщина линий едет вместе с ним.',
    }),
  ]);
  const sizeOut = el('output', { textContent: `${state.size} px` });
  const sizeInput = el('input', { type: 'range', min: '20', max: '160', step: '2', value: String(state.size) });
  sizeInput.addEventListener('input', () => {
    state.size = Number(sizeInput.value);
    sizeOut.textContent = `${state.size} px`;
    schedule();
  });
  sizes.append(
    el('div', { class: 'knob' }, [
      el('div', { class: 'knob-head' }, [el('label', { textContent: 'Радиус гекса' }), sizeOut]),
      sizeInput,
    ])
  );
  panel.append(sizes);

  const rolls = el('section', {}, [
    el('h2', { textContent: 'Розыгрыш' }),
    el('p', {
      class: 'note',
      textContent: 'Вариант — соседняя картинка той же плитки. Сид пересоздаёт всю коллекцию.',
    }),
  ]);
  rolls.append(stepper('Вариант', () => state.variant, (value) => (state.variant = ((value % 6) + 6) % 6)));
  rolls.append(
    stepper('Сид', () => state.seed, (value) => (state.seed = Math.max(1, Math.min(9, value))))
  );
  panel.append(rolls);

  const show = el('section', {}, [el('h2', { textContent: 'Показывать' })]);
  show.append(
    toggle('Подложку', () => state.under, (value) => (state.under = value)),
    toggle('Сетку гексов', () => state.grid, (value) => (state.grid = value)),
    toggle('Швы', () => state.seams, (value) => (state.seams = value))
  );
  const legend = el('div', { class: 'legend' },
    (Object.keys(SEAM_LABEL) as Meets[]).map((meets) =>
      el('span', {}, [el('i', { style: `background:${SEAM_COLOUR[meets]}` }), SEAM_LABEL[meets]])
    )
  );
  show.append(legend);
  panel.append(show);

  const backdrop = el('section', {}, [el('h2', { textContent: 'Фон' })]);
  const select = el('select');
  for (const [value, label] of [
    ['paper', 'Бумага'],
    ['land', 'Суша'],
    ['water', 'Вода'],
    ['ink', 'Тёмный'],
  ] as Array<[Background, string]>) {
    select.append(el('option', { value, textContent: label }));
  }
  select.value = state.background;
  select.addEventListener('change', () => {
    state.background = select.value as Background;
    document.body.dataset.bg = state.background;
  });
  backdrop.append(select);
  panel.append(backdrop);

  const filters = el('section', {}, [
    el('h2', { textContent: 'Группы' }),
    el('p', { class: 'note', textContent: 'Полки коллекции. Скрытые не рисуются вовсе.' }),
  ]);
  for (const group of GROUPS) {
    filters.append(
      toggle(
        group.title,
        () => state.groups.has(group.id),
        (value) => {
          if (value) state.groups.add(group.id);
          else state.groups.delete(group.id);
        }
      )
    );
  }
  panel.append(filters);

  const exports = el('section', {}, [
    el('h2', { textContent: 'Выгрузка' }),
    el('p', {
      class: 'note',
      textContent: 'То же, что пишет pnpm tiles:build — генератор один на оба пути.',
    }),
  ]);
  const buttons = el('div', { class: 'buttons' });
  buttons.append(
    action('collection.json', () =>
      download(
        'collection.json',
        JSON.stringify(buildManifest({ seed: seedOf(), previewSize: state.size }), null, 2),
        'application/json'
      )
    ),
    action('sprite.svg', () =>
      download('sprite.svg', spriteSvg(visibleTiles(), { seed: seedOf(), size: 96 }), 'image/svg+xml')
    )
  );
  exports.append(buttons);
  panel.append(exports);

  return panel;
}

function stepper(label: string, get: () => number, set: (value: number) => void): HTMLElement {
  const value = el('span', { class: 'seed', textContent: String(get()) });
  const step = (delta: number) => {
    set(get() + delta);
    value.textContent = String(get());
    schedule();
  };
  const minus = el('button', { textContent: '−' });
  const plus = el('button', { textContent: '+' });
  minus.addEventListener('click', () => step(-1));
  plus.addEventListener('click', () => step(1));
  return el('div', { class: 'row' }, [
    el('label', { textContent: label }),
    el('div', { class: 'stepper' }, [minus, value, plus]),
  ]);
}

function toggle(label: string, get: () => boolean, set: (value: boolean) => void): HTMLElement {
  const input = el('input', { type: 'checkbox' });
  input.checked = get();
  input.addEventListener('change', () => {
    set(input.checked);
    schedule();
  });
  return el('label', { class: 'toggle' }, [input, label]);
}

function action(label: string, run: () => void): HTMLElement {
  const button = el('button', { class: 'accent', textContent: label });
  button.addEventListener('click', run);
  return button;
}

function download(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = el('a', { href: url, download: name });
  link.click();
  URL.revokeObjectURL(url);
}

/* ────────────────────────────────  Painting  ───────────────────────────── */

const visibleTiles = (): Tile[] => tiles.filter((tile) => state.groups.has(tile.group));

const stage = el('main', { class: 'stage' });

function section(title: string, note: string, body: Node): HTMLElement {
  return el('section', { class: 'block' }, [
    el('div', { class: 'block-head' }, [
      el('h2', { textContent: title }),
      el('p', { textContent: note }),
    ]),
    body,
  ]);
}

function paint(): void {
  stage.replaceChildren();

  stage.append(
    section(
      'Объекты',
      'Больше клетки. Хранится не картинка, а список: какая плитка на какой гексагон и как повёрнута.',
      el('div', { class: 'objects' }, assemblies.map(assemblyCard))
    )
  );

  stage.append(
    section(
      'Стопка',
      'На одну клетку кладётся несколько плиток. Порядок задаёт слой: основа, поверхность, рельеф, метка.',
      stackStrip()
    )
  );

  for (const group of GROUPS) {
    if (!state.groups.has(group.id)) continue;
    const members = tiles.filter((tile) => tile.group === group.id);
    if (!members.length) continue;
    stage.append(section(group.title, group.note, el('div', { class: 'grid' }, members.map(tileCard))));
  }
}

let pending = 0;
function schedule(): void {
  window.clearTimeout(pending);
  pending = window.setTimeout(paint, 40);
}

const app = document.getElementById('app')!;
app.append(buildPanel(), stage);
document.body.dataset.bg = state.background;
paint();
