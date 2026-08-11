/**
 * The objects: what the pieces add up to.
 *
 * Each one is a plain list of cells, so it survives the trip through JSON — a
 * consumer holding the tiles and this recipe can rebuild the object without
 * knowing anything about how any of it was drawn. That is the point of storing
 * the assembly rather than a finished picture of it.
 *
 * The two rings are computed rather than typed out, because the arithmetic is
 * the explanation: a ring cell only has to turn its water arc towards — or away
 * from — the middle, and the same coast piece then serves a lake and an island.
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
    note:
      'Пять клеток в ряд. Куски стыкуются по гребню на середине западной и восточной грани, ' +
      'поэтому ряд можно удлинять склонами сколько угодно. Западный конец — то же окончание, ' +
      'что и восточный, только отражённое: рельефу нельзя вращаться, у него есть верх.',
    cells: [
      at(-2, 0, 'grass-plain', 'pebbles', { tile: 'mountain-foot', flip: true }, 'pines'),
      at(-1, 0, 'rock-plain', { tile: 'mountain-slope', variant: 1 }),
      at(0, 0, 'rock-plain', { tile: 'mountain-peak', opts: { cap: 'snow' } }),
      at(1, 0, 'rock-plain', { tile: 'mountain-slope', flip: true, variant: 2 }),
      at(2, 0, 'grass-plain', 'pebbles', 'mountain-foot'),
    ],
  },

  {
    id: 'lake',
    title: 'Озеро',
    note:
      'Гладь в середине, шесть «Поворотов берега» вокруг. Каждый повёрнут так, чтобы вода ' +
      'смотрела внутрь, и линия берега сходится в общих углах — отдельной плитки на озеро не нужно.',
    cells: [
      at(0, 0, { tile: 'lake-water', opts: { water: 'lake' } }),
      ...ring(
        (direction) => ({
          tile: 'coast-corner',
          // The water faces back the way we came.
          rotate: turnTo(1, rotateEdge(direction, 3)),
          opts: { water: 'lake', land: 'grass' },
          variant: direction,
        }),
        // Reeds only where the water ends up at the bottom of the cell.
        { 4: ['reeds'], 5: ['reeds'] }
      ),
    ],
  },

  {
    id: 'island',
    title: 'Остров',
    note:
      'То же кольцо, вывернутое наизнанку: вода смотрит наружу, поэтому берётся «Мыс» — ' +
      'три водные грани из шести. Внутри остаётся одна клетка суши, на которой и стоит всё живое.',
    cells: [
      at(0, 0, 'grass-plain', 'grass-tufts', 'hill', 'tree'),
      ...ring(
        (direction) => ({
          tile: 'coast-cape',
          // Canonical arc is centred on edge 2; the outward arc on `direction`.
          rotate: turnTo(2, direction),
          opts: { water: 'sea', land: 'grass' },
          variant: direction,
        }),
        { 1: ['reeds'], 2: ['pebbles'] }
      ),
    ],
  },

  {
    id: 'river-run',
    title: 'Река до моря',
    note:
      'Исток в камнях, два прямых участка, излучина и устье. Русло выходит из клетки строго ' +
      'через середину грани и одной ширины у всех кусков — поэтому повороты набираются из двух ' +
      'плиток, а не из отдельной картинки на каждый изгиб.',
    cells: [
      at(0, 0, 'rock-plain', 'pebbles', 'river-spring'),
      at(1, 0, 'grass-plain', 'grass-tufts', 'river-straight'),
      at(2, 0, 'grass-plain', { tile: 'river-bend', rotate: 1 }),
      at(2, 1, 'grass-plain', 'grass-tufts', { tile: 'river-straight', rotate: 1 }),
      at(2, 2, { tile: 'river-mouth', rotate: 1, opts: { water: 'sea', land: 'grass' } }, 'reeds'),
      at(2, 3, 'sea-plain', 'ripples'),
      at(1, 3, 'sea-plain', 'swell'),
    ],
  },

  {
    id: 'bay',
    title: 'Залив',
    note:
      'Ряд берега с двумя бухтами подряд. Все четыре клетки — один и тот же шов, вода за двумя ' +
      'южными гранями; разница только в том, куда выгнута линия.',
    cells: [
      at(0, 0, { tile: 'coast-shore', opts: { land: 'grass' } }, 'pebbles'),
      at(1, 0, { tile: 'coast-cove', opts: { land: 'grass' } }, 'reeds'),
      at(2, 0, { tile: 'coast-cove', opts: { land: 'grass' }, variant: 2 }, 'reeds'),
      at(3, 0, { tile: 'coast-shore', opts: { land: 'grass' }, variant: 3 }),
      at(-1, 1, 'sea-plain', 'swell'),
      at(0, 1, 'sea-plain', 'ripples'),
      at(1, 1, 'sea-plain', 'ripples'),
      at(2, 1, 'sea-plain', 'swell'),
      at(3, 1, 'sea-plain', 'ripples'),
      at(0, -1, 'grass-plain', 'forest-dense'),
      at(1, -1, 'grass-plain', 'grass-tufts', 'forest-grove'),
      at(2, -1, 'grass-plain', 'flowers'),
      at(3, -1, 'grass-plain', 'grass-tufts', 'hill'),
    ],
  },

  {
    id: 'grove',
    title: 'Опушка',
    note:
      'Ни одного шва: четыре клетки, собранные только наложением. Земля, поверх неё узор, ' +
      'поверх узора лес — так из шести плиток получается вид, которого ни одна из них не содержит.',
    cells: [
      at(0, 0, 'soil-plain', 'furrows', 'grass-tufts'),
      at(1, 0, 'grass-plain', 'forest-dense'),
      at(0, 1, 'grass-plain', 'grass-tufts', 'forest-grove'),
      at(1, 1, 'grass-plain', 'flowers', 'tree'),
    ],
  },
];
