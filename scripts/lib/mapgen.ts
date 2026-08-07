import type { Continent, Domain } from '../../shared/schema.js';

/**
 * Generates public/map.svg: domains as adjacent territories, area proportional
 * to the number of courses, dependencies placed next to their sources.
 *
 * The output is a plain SVG whose `<path id>` values equal `domain.shapeId`, so
 * a hand-drawn map from Figma can replace it byte-for-byte as long as it keeps
 * the same ids. Generating it is what keeps "empty outskirts are visible as
 * work to do" true without anyone redrawing the map after every content PR.
 */

const HEX_R = 17;
const SQRT3 = Math.sqrt(3);

type Axial = { q: number; r: number };
type Key = string;

const key = (q: number, r: number): Key => `${q},${r}`;

/** Neighbour directions ordered so that direction `d` sits between corners d and d+1. */
const DIRECTIONS: Axial[] = [
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
];

function centerOf(q: number, r: number): { x: number; y: number } {
  return { x: HEX_R * SQRT3 * (q + r / 2), y: HEX_R * 1.5 * r };
}

function cornerOf(q: number, r: number, index: number): { x: number; y: number } {
  const c = centerOf(q, r);
  const angle = ((60 * index - 30) * Math.PI) / 180;
  return { x: c.x + HEX_R * Math.cos(angle), y: c.y + HEX_R * Math.sin(angle) };
}

/* ─────────────────────────────  Continent layout  ──────────────────────── */

const CONTINENT_ANCHORS: Record<Continent, { x: number; y: number; rx: number; ry: number }> = {
  // Formal sits left and large; social is the isthmus between the two masses;
  // humanities is a separate continent on the right.
  formal: { x: 470, y: 450, rx: 360, ry: 330 },
  social: { x: 1010, y: 690, rx: 250, ry: 190 },
  humanities: { x: 1230, y: 320, rx: 320, ry: 270 },
};

export type MapCell = { q: number; r: number; x: number; y: number };

/** One elliptical landmass covering all three continents, generated once. */
function buildField(width: number, height: number): MapCell[] {
  const cells: MapCell[] = [];
  const cx = width / 2;
  const cy = height / 2;
  const rx = width / 2;
  const ry = height / 2;

  const rMax = Math.ceil(height / (HEX_R * 1.5)) + 2;
  for (let r = -2; r <= rMax; r++) {
    const qMin = Math.floor(-r / 2) - 2;
    const qMax = qMin + Math.ceil(width / (HEX_R * SQRT3)) + 4;
    for (let q = qMin; q <= qMax; q++) {
      const c = centerOf(q, r);
      const nx = (c.x - cx) / rx;
      const ny = (c.y - cy) / ry;
      if (nx * nx + ny * ny <= 1) cells.push({ q, r, x: c.x, y: c.y });
    }
  }
  return cells;
}

/* ────────────────────────────  Anchor placement  ───────────────────────── */

/**
 * Depth inside the domain dependency graph — domains that depend on nothing sit
 * at the centre of their continent, their dependants ring outwards. This is the
 * same idea as course `level`, applied to territories.
 */
function domainDepths(domains: Domain[]): Map<string, number> {
  const byId = new Map(domains.map((d) => [d.id, d]));
  const depth = new Map<string, number>();

  const visit = (id: string, guard: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (guard.has(id)) return 0; // domain dependencies may be mutual; stop here
    guard.add(id);
    const sources = byId.get(id)?.dependsOn ?? [];
    const value = sources.length
      ? Math.max(...sources.map((s) => visit(s, guard))) + 1
      : 0;
    depth.set(id, value);
    return value;
  };

  for (const domain of domains) visit(domain.id, new Set());
  return depth;
}

const HEX_AREA = 1.5 * SQRT3 * HEX_R * HEX_R;

/**
 * Anchors decide where each territory starts growing. Two forces shape them:
 * a domain is pulled towards the domains it draws from, and pushed away from
 * every other domain by the radius its own area needs.
 *
 * The second force is what makes the map honest. Without it a large domain
 * simply engulfs the anchors of its neighbours during growth, and the biggest
 * field on the map ends up drawn as one of the smallest.
 */
function computeAnchors(
  domains: Domain[],
  quotas: Map<string, number>,
  width: number,
  height: number
): Map<string, { x: number; y: number }> {
  const depth = domainDepths(domains);
  const anchors = new Map<string, { x: number; y: number }>();
  const radiusOf = (id: string): number =>
    Math.sqrt(((quotas.get(id) ?? 1) * HEX_AREA) / Math.PI);

  const byContinent = new Map<Continent, Domain[]>();
  for (const domain of domains) {
    const list = byContinent.get(domain.continent) ?? [];
    list.push(domain);
    byContinent.set(domain.continent, list);
  }

  // Initial rings: ring k sits outside the total area of rings 0…k-1, so a
  // dependent never starts inside the territory it depends on.
  for (const [continent, list] of byContinent) {
    const centre = CONTINENT_ANCHORS[continent];
    const rings = new Map<number, Domain[]>();
    for (const domain of list) {
      const d = depth.get(domain.id) ?? 0;
      rings.set(d, [...(rings.get(d) ?? []), domain]);
    }

    let cumulativeCells = 0;
    for (const ring of [...rings.keys()].sort((a, b) => a - b)) {
      const members = rings.get(ring)!;
      const inner = Math.sqrt((cumulativeCells * HEX_AREA) / Math.PI);
      const ringRadius = ring === 0 ? 0 : inner + radiusOf(members[0].id) * 0.9;
      members.forEach((domain, index) => {
        const angle = (index / members.length) * TAU + ring * 0.9;
        anchors.set(domain.id, {
          x: centre.x + Math.cos(angle) * ringRadius,
          y: centre.y + Math.sin(angle) * ringRadius * 0.85,
        });
      });
      cumulativeCells += members.reduce((sum, d) => sum + (quotas.get(d.id) ?? 0), 0);
    }
  }

  const byId = new Map(domains.map((d) => [d.id, d]));

  for (let pass = 0; pass < 80; pass++) {
    for (const domain of domains) {
      const own = anchors.get(domain.id)!;
      const centre = CONTINENT_ANCHORS[domain.continent];

      // Attraction. A bridge domain is pulled by all of its sources and so
      // drifts into the strait between the continents it draws from. A regular
      // domain is only pulled by sources on its own continent — otherwise
      // linguistics, which draws on logic, migrates into the formal landmass
      // and the three continents stop being three.
      const sources = domain.dependsOn.filter(
        (id) => domain.bridge || byId.get(id)?.continent === domain.continent
      );
      if (sources.length) {
        let sx = 0;
        let sy = 0;
        let n = 0;
        for (const source of sources) {
          const point = anchors.get(source);
          if (!point) continue;
          sx += point.x;
          sy += point.y;
          n += 1;
        }
        if (n) {
          const pull = (domain.bridge ? 0.14 : 0.06) * (1 - pass / 160);
          own.x += (sx / n - own.x) * pull;
          own.y += (sy / n - own.y) * pull;
        }
      }

      // Cohesion: keeps a continent a continent while repulsion spreads it out.
      if (!domain.bridge) {
        own.x += (centre.x - own.x) * 0.035;
        own.y += (centre.y - own.y) * 0.035;
      }
    }

    // Repulsion: every pair must be at least as far apart as the two radii
    // their areas require.
    for (let i = 0; i < domains.length; i++) {
      for (let j = i + 1; j < domains.length; j++) {
        const a = anchors.get(domains[i].id)!;
        const b = anchors.get(domains[j].id)!;
        // Domains on different continents stand further apart, which is what
        // opens the straits the bridge domains then settle into.
        const foreign =
          domains[i].continent !== domains[j].continent &&
          !domains[i].bridge &&
          !domains[j].bridge;
        const wanted =
          (radiusOf(domains[i].id) + radiusOf(domains[j].id)) * (foreign ? 1.3 : 0.92);
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d > wanted) continue;
        if (d < 1e-6) {
          // Identical anchors would divide by zero; nudge them deterministically.
          dx = (i % 2 ? 1 : -1) * 0.7;
          dy = (j % 2 ? 1 : -1) * 0.7;
          d = Math.hypot(dx, dy);
        }
        const push = ((wanted - d) / d) * 0.5;
        a.x -= dx * push;
        a.y -= dy * push;
        b.x += dx * push;
        b.y += dy * push;
      }
    }

    // Containment: repulsion pushes the outermost domains off the landmass,
    // where there are no cells left to grow into. Keep every anchor inside the
    // field with room for its own radius.
    for (const domain of domains) {
      const point = anchors.get(domain.id)!;
      const rx = width / 2 - radiusOf(domain.id) * 0.85;
      const ry = height / 2 - radiusOf(domain.id) * 0.85;
      const nx = (point.x - width / 2) / rx;
      const ny = (point.y - height / 2) / ry;
      const length = Math.hypot(nx, ny);
      if (length <= 1) continue;
      point.x = width / 2 + (nx / length) * rx;
      point.y = height / 2 + (ny / length) * ry;
    }
  }

  return anchors;
}

/* ───────────────────────────────  Growing  ─────────────────────────────── */

export type Territory = { domainId: string; cells: Set<Key> };

function grow(
  field: MapCell[],
  domains: Domain[],
  quotas: Map<string, number>,
  anchors: Map<string, { x: number; y: number }>
): Map<string, Territory> {
  const cellByKey = new Map(field.map((c) => [key(c.q, c.r), c]));
  const owner = new Map<Key, string>();
  const territories = new Map<string, Territory>();

  const distance = (cell: MapCell, id: string): number => {
    const a = anchors.get(id)!;
    return (cell.x - a.x) ** 2 + (cell.y - a.y) ** 2;
  };

  // Seed every domain at the free cell closest to its anchor, largest first so
  // the big territories get the ground they need before the small ones fill in.
  const order = [...domains].sort((a, b) => (quotas.get(b.id) ?? 0) - (quotas.get(a.id) ?? 0));
  for (const domain of order) {
    let best: MapCell | null = null;
    let bestDistance = Infinity;
    for (const cell of field) {
      const k = key(cell.q, cell.r);
      if (owner.has(k)) continue;
      const d = distance(cell, domain.id);
      if (d < bestDistance) {
        bestDistance = d;
        best = cell;
      }
    }
    if (!best) continue;
    const k = key(best.q, best.r);
    owner.set(k, domain.id);
    territories.set(domain.id, { domainId: domain.id, cells: new Set([k]) });
  }

  /** Cheapest free cell adjacent to a territory, by distance to its anchor. */
  const bestNeighbour = (territory: Territory): Key | null => {
    let best: Key | null = null;
    let bestDistance = Infinity;
    for (const k of territory.cells) {
      const [q, r] = k.split(',').map(Number);
      for (const dir of DIRECTIONS) {
        const nk = key(q + dir.q, r + dir.r);
        if (owner.has(nk)) continue;
        const cell = cellByKey.get(nk);
        if (!cell) continue;
        const d = distance(cell, territory.domainId);
        if (d < bestDistance) {
          bestDistance = d;
          best = nk;
        }
      }
    }
    return best;
  };

  /**
   * Growth is proportional, not round-robin: whoever is furthest from its quota
   * grows next. Plain round-robin lets a dozen small domains ring a large one
   * before it has expanded, and the largest territory ends up the smallest.
   */
  const blocked = new Set<string>();
  for (;;) {
    let chosen: Territory | null = null;
    let lowestFill = Infinity;

    for (const domain of order) {
      if (blocked.has(domain.id)) continue;
      const territory = territories.get(domain.id);
      if (!territory) continue;
      const quota = Math.max(1, quotas.get(domain.id) ?? 1);
      const fill = territory.cells.size / quota;
      if (fill >= 1) continue;
      if (fill < lowestFill) {
        lowestFill = fill;
        chosen = territory;
      }
    }

    if (!chosen) break;
    const next = bestNeighbour(chosen);
    if (!next) {
      blocked.add(chosen.domainId); // fully enclosed — it keeps what it has
      continue;
    }
    owner.set(next, chosen.domainId);
    chosen.cells.add(next);
  }

  return territories;
}

/* ──────────────────────────────  Outlining  ────────────────────────────── */

const pointKey = (p: { x: number; y: number }): string =>
  `${p.x.toFixed(2)},${p.y.toFixed(2)}`;

/**
 * Merges the hexes of one territory into closed outlines: every edge that is
 * not shared with another hex of the same domain is a border, and borders chain
 * into loops.
 */
type Edge = { from: { x: number; y: number }; to: { x: number; y: number } };

const TAU = Math.PI * 2;

function outline(cells: Set<Key>): string {
  // A vertex can be the start of more than one border edge where a territory
  // pinches, so edges are bucketed by their start point rather than replacing
  // one another — silently dropping one truncates the whole outline.
  const outgoing = new Map<string, Edge[]>();
  let remaining = 0;

  for (const k of cells) {
    const [q, r] = k.split(',').map(Number);
    for (let d = 0; d < 6; d++) {
      const neighbour = key(q + DIRECTIONS[d].q, r + DIRECTIONS[d].r);
      if (cells.has(neighbour)) continue;
      const edge: Edge = { from: cornerOf(q, r, d), to: cornerOf(q, r, (d + 1) % 6) };
      const bucket = outgoing.get(pointKey(edge.from)) ?? [];
      bucket.push(edge);
      outgoing.set(pointKey(edge.from), bucket);
      remaining += 1;
    }
  }

  const take = (vertex: string, incoming: Edge | null): Edge | null => {
    const bucket = outgoing.get(vertex);
    if (!bucket?.length) return null;
    if (bucket.length === 1 || !incoming) return bucket.shift()!;

    // Standard face-tracing rule: continue with the sharpest turn away from
    // where we came from. Any other choice can leave a loop that never closes.
    const back = Math.atan2(incoming.from.y - incoming.to.y, incoming.from.x - incoming.to.x);
    let bestIndex = 0;
    let bestTurn = Infinity;
    bucket.forEach((edge, index) => {
      const direction = Math.atan2(edge.to.y - edge.from.y, edge.to.x - edge.from.x);
      const turn = ((back - direction) % TAU + TAU) % TAU;
      if (turn > 1e-9 && turn < bestTurn) {
        bestTurn = turn;
        bestIndex = index;
      }
    });
    return bucket.splice(bestIndex, 1)[0];
  };

  const parts: string[] = [];
  while (remaining > 0) {
    const startVertex = [...outgoing.entries()].find(([, list]) => list.length)?.[0];
    if (!startVertex) break;

    let edge = take(startVertex, null)!;
    remaining -= 1;
    const loop: Array<{ x: number; y: number }> = [edge.from];

    for (let guard = 0; guard < 200000; guard++) {
      const next = take(pointKey(edge.to), edge);
      if (!next) break;
      remaining -= 1;
      loop.push(next.from);
      edge = next;
      if (pointKey(edge.to) === startVertex) break;
    }

    if (loop.length < 3) continue;
    parts.push(`M${loop.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('L')}Z`);
  }
  return parts.join('');
}

/** `x y w h` covering every drawn path, with a small margin. */
function boundingBox(paths: string[], margin = 24): string {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const d of paths) {
    const numbers = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    for (let i = 0; i + 1 < numbers.length; i += 2) {
      minX = Math.min(minX, numbers[i]);
      maxX = Math.max(maxX, numbers[i]);
      minY = Math.min(minY, numbers[i + 1]);
      maxY = Math.max(maxY, numbers[i + 1]);
    }
  }
  if (!Number.isFinite(minX)) return '0 0 100 100';

  return [
    (minX - margin).toFixed(1),
    (minY - margin).toFixed(1),
    (maxX - minX + margin * 2).toFixed(1),
    (maxY - minY + margin * 2).toFixed(1),
  ].join(' ');
}

function centroid(cells: Set<Key>): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  for (const k of cells) {
    const [q, r] = k.split(',').map(Number);
    const c = centerOf(q, r);
    sx += c.x;
    sy += c.y;
  }
  return { x: sx / cells.size, y: sy / cells.size };
}

/* ─────────────────────────────────  Public  ────────────────────────────── */

export type MapGenInput = {
  domains: Domain[];
  courseCounts: Map<string, number>;
  width?: number;
  height?: number;
};

export type MapGenResult = {
  svg: string;
  /** Per-domain outcome, so the caller can report territories that got squeezed. */
  stats: Array<{ id: string; cells: number; quota: number }>;
};

export function generateMapSvg({
  domains,
  courseCounts,
  width = 1680,
  height = 980,
}: MapGenInput): MapGenResult {
  const field = buildField(width, height);

  // Area proportional to the number of courses, with a floor so that an empty
  // domain still has a territory — an empty outskirt is a task, not a hole.
  const quotas = new Map(
    domains.map((d) => [d.id, 2 + Math.round((courseCounts.get(d.id) ?? 0) * 2.5)])
  );

  const anchors = computeAnchors(domains, quotas, width, height);
  const territories = grow(field, domains, quotas, anchors);

  const drawn = domains
    .map((domain) => {
      const territory = territories.get(domain.id);
      if (!territory || !territory.cells.size) return null;
      return { domain, centre: centroid(territory.cells), d: outline(territory.cells) };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  // The territories never fill the whole generation field, so the viewBox is
  // cropped to what was actually drawn — otherwise the map renders as a small
  // island in the middle of a large empty rectangle.
  const box = boundingBox(drawn.map((item) => item.d));

  const paths = drawn
    .map(
      ({ domain, centre, d }) =>
        `<path id="${domain.shapeId}" class="domain-shape" ` +
        `data-domain="${domain.id}" data-continent="${domain.continent}" ` +
        `data-cx="${centre.x.toFixed(1)}" data-cy="${centre.y.toFixed(1)}" ` +
        `d="${d}"/>`
    )
    .join('\n  ');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" preserveAspectRatio="xMidYMid meet">
  <!-- Generated by \`pnpm data:map\`. Ids match domain.shapeId — a hand-drawn
       map may replace this file as long as it keeps them. -->
  ${paths}
</svg>
`;

  return {
    svg,
    stats: domains.map((d) => ({
      id: d.id,
      cells: territories.get(d.id)?.cells.size ?? 0,
      quota: quotas.get(d.id) ?? 0,
    })),
  };
}
