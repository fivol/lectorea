/**
 * The objects: what the pieces add up to.
 *
 * Each one is a plain list of cells, so it survives the trip through JSON — a
 * consumer holding the tiles and this recipe can rebuild the object without
 * knowing anything about how it was drawn. That is the point of storing the
 * assembly rather than a finished picture of it.
 *
 * The island ring is computed rather than typed out, because the arithmetic is
 * the explanation: a ring cell only has to turn its water arc away from the
 * middle, and one coast piece then covers the whole outline.
 */

import { DIRECTIONS, rotateEdge } from '../hex.js';
import { at, type Assembly, type Cell, type Placement } from '../types.js';

/** Sixths of a turn that move a tile's canonical arc onto `wanted`. */
const turnTo = (canonical: number, wanted: number) => rotateEdge(wanted - canonical, 0);

/**
 * The six cells around the origin, in direction order, with anything extra the
 * cell should carry on top. Decor goes into the same stack rather than into a
 * second cell at the same coordinates: one hex, one entry.
 */
function ring(
  build: (direction: number) => Placement,
  decor: Record<number, Array<string | Placement>> = {}
): Cell[] {
  return DIRECTIONS.map((step, direction) =>
    at(step.q, step.r, build(direction), ...(decor[direction] ?? []))
  );
}

export const assemblies: Assembly[] = [
  {
    id: 'mountain-range',
    title: 'Хребет',
    over: 'land',
    note:
      'Пять клеток в ряд. Куски стыкуются по гребню на середине западной и восточной грани, ' +
      'поэтому ряд можно удлинять склонами сколько угодно. Западный конец — то же окончание, ' +
      'что и восточный, только отражённое: рельефу нельзя вращаться, у него есть верх. ' +
      'Ни одна клетка не закрашена — под хребтом виден цвет области.',
    cells: [
      at(-2, 0, { tile: 'mountain-foot', flip: true }),
      at(-1, 0, { tile: 'mountain-slope', variant: 1 }),
      at(0, 0, { tile: 'mountain-peak', opts: { cap: 'snow' } }),
      at(1, 0, { tile: 'mountain-slope', flip: true, variant: 2 }),
      at(2, 0, 'mountain-foot'),
    ],
  },

  {
    id: 'highlands',
    title: 'Нагорье',
    over: 'land',
    note:
      'Внутренность материка без единой капли воды: плато с обрывом, каньон вдоль него, ' +
      'холмы по краям и вулкан как заметная точка. Плато и каньон стыкуются по востоку ' +
      'и западу — из них набирается полоса любой длины.',
    cells: [
      at(-1, 0, 'hills'),
      at(0, 0, 'plateau'),
      at(1, 0, { tile: 'plateau', variant: 2 }),
      at(0, 1, 'canyon'),
      at(1, 1, { tile: 'canyon', variant: 1 }),
      at(2, 1, { tile: 'hills', variant: 3 }),
      at(1, -1, 'volcano'),
      at(2, -1, 'crags'),
    ],
  },

  {
    id: 'river-run',
    title: 'Река до моря',
    over: 'land',
    note:
      'Исток в горах, прямой участок, излучина и устье. Русло выходит из клетки строго ' +
      'через середину грани и одной ширины у всех кусков — поэтому повороты набираются ' +
      'из двух плиток, а не из отдельной картинки на каждый изгиб.',
    cells: [
      at(0, 0, 'crags', 'river-spring'),
      at(1, 0, 'river-straight'),
      at(2, 0, { tile: 'river-bend', rotate: 1 }),
      at(2, 1, { tile: 'river-straight', rotate: 1 }),
      at(2, 2, { tile: 'river-mouth', rotate: 1 }),
      at(2, 3, 'water-plain', 'swell'),
      at(1, 3, 'water-plain', 'shallows'),
    ],
  },

  {
    id: 'island',
    title: 'Остров',
    over: 'land',
    note:
      'Шесть «Мысов» вокруг одной клетки суши: каждый повёрнут так, чтобы вода смотрела ' +
      'наружу, и линия берега сходится в общих углах. Отдельной плитки на остров не нужно — ' +
      'и середина остаётся цветом области, на ней стоит рельеф.',
    cells: [
      at(0, 0, 'hills'),
      ...ring(
        (direction) => ({
          tile: 'coast-cape',
          // Canonical arc is centred on edge 2; the outward arc on `direction`.
          rotate: turnTo(2, direction),
          variant: direction,
        }),
        { 1: ['skerries'], 4: ['shallows'] }
      ),
    ],
  },

  {
    id: 'bay',
    title: 'Залив',
    over: 'land',
    note:
      'Ряд берега: пляж, две бухты подряд и обрыв там, где к морю выходят скалы. Все клетки — ' +
      'один и тот же шов, вода за двумя южными гранями; разница только в том, куда выгнута ' +
      'линия и чем она обрывается.',
    cells: [
      at(0, 0, 'coast-shore'),
      at(1, 0, 'coast-cove'),
      at(2, 0, { tile: 'coast-cove', variant: 2 }),
      at(3, 0, 'coast-cliff'),
      at(3, -1, 'crags'),
      at(2, -1, { tile: 'hills', variant: 1 }),
      at(-1, 1, 'water-plain', 'swell'),
      at(0, 1, 'water-plain', 'shallows'),
      at(1, 1, 'water-plain', 'shallows', 'reef'),
      at(2, 1, 'water-plain', { tile: 'swell', variant: 3 }),
      at(3, 1, 'water-plain', 'skerries'),
    ],
  },

  {
    id: 'open-sea',
    title: 'Открытое море',
    over: 'water',
    note:
      'То, из чего состоит бо́льшая часть карты островов. Течение тянется через клетки по ' +
      'тем же правилам, что русло реки, и обходит водоворот; глубина и отмель дают дну ' +
      'форму, риф и островки — опасность.',
    cells: [
      at(0, 0, 'water-plain', 'deep', { tile: 'current-straight' }),
      at(1, 0, 'water-plain', { tile: 'current-bend', rotate: 1 }),
      at(1, 1, 'water-plain', { tile: 'current-straight', rotate: 1 }),
      at(2, 0, 'water-plain', 'whirlpool'),
      at(0, 1, 'water-plain', 'shallows', 'reef'),
      at(-1, 1, 'water-plain', 'skerries'),
      at(0, -1, 'water-plain', 'swell'),
      at(1, -1, 'water-plain', 'ice-floes'),
    ],
  },
];
