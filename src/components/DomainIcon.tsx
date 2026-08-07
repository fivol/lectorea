/**
 * One line-art glyph per domain, on a 24×24 grid.
 *
 * Inline rather than one SVG file per domain: the map screen shows all 39 at
 * once, so files would mean 39 requests for ~200 bytes each, and `currentColor`
 * would be lost — the glyph has to take the domain's colour and the theme's
 * contrast, which a linked image cannot do.
 *
 * Everything is stroked, nothing is filled, so the whole set stays legible at
 * 14 px next to a heading and at 40 px in the middle of a territory.
 */

/** A circle as path data, since these glyphs are a flat list of `d` strings. */
function dot(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;
}

type Glyph = { d: string; transform?: string };

const GLYPHS: Record<string, Glyph[]> = {
  /* ────────────────────────  Formal and natural  ──────────────────────── */

  // Summation sign — the one symbol every field below borrows from.
  math: [{ d: 'M17.5 4.5h-11l7 7.5-7 7.5h11' }],

  // Turnstile: "therefore".
  logic: [{ d: 'M5 4v16' }, { d: 'M5 12h9' }, { d: 'M14.5 8.5l3.5 3.5-3.5 3.5' }],

  // A normal distribution over its axis.
  probability: [{ d: 'M3 18c4.5 0 3-11 9-11s4.5 11 9 11' }, { d: 'M2.5 20.5h19' }],

  // Angle brackets and a slash.
  cs: [{ d: 'M8.5 8l-4.5 4 4.5 4' }, { d: 'M15.5 8l4.5 4-4.5 4' }, { d: 'M13.5 5.5l-3 13' }],

  // A three-layer network.
  'machine-learning': [
    { d: 'M6.6 7.6l3.8 3.8M6.6 16.4l3.8-3.8M13.6 11.4l3.8-3.8M13.6 12.6l3.8 3.8' },
    { d: dot(5, 7, 1.6) },
    { d: dot(5, 17, 1.6) },
    { d: dot(12, 12, 1.6) },
    { d: dot(19, 7, 1.6) },
    { d: dot(19, 17, 1.6) },
  ],

  // Atom: three orbits and a nucleus.
  physics: [
    { d: 'M12 4.5a3.5 7.5 0 0 1 0 15a3.5 7.5 0 0 1 0-15' },
    { d: 'M12 4.5a3.5 7.5 0 0 1 0 15a3.5 7.5 0 0 1 0-15', transform: 'rotate(60 12 12)' },
    { d: 'M12 4.5a3.5 7.5 0 0 1 0 15a3.5 7.5 0 0 1 0-15', transform: 'rotate(120 12 12)' },
    { d: dot(12, 12, 1.5) },
  ],

  // A ringed planet.
  astronomy: [
    { d: dot(12, 12, 4.8) },
    { d: 'M3 12a9 3 0 1 0 18 0a9 3 0 1 0-18 0', transform: 'rotate(-22 12 12)' },
  ],

  // Round-bottom flask with its liquid line.
  chemistry: [
    { d: 'M9.5 3h5' },
    { d: 'M10.5 3v6.5L5.8 18a2 2 0 0 0 1.8 3h8.8a2 2 0 0 0 1.8-3l-4.7-8.5V3' },
    { d: 'M7.2 15.5h9.6' },
  ],

  // Two orbitals crossing over a nucleus.
  'quantum-chemistry': [
    { d: 'M12 6a3 6 0 0 1 0 12a3 6 0 0 1 0-12', transform: 'rotate(45 12 12)' },
    { d: 'M12 6a3 6 0 0 1 0 12a3 6 0 0 1 0-12', transform: 'rotate(-45 12 12)' },
    { d: dot(12, 12, 1.3) },
  ],

  // Globe with an equator and a meridian.
  'earth-science': [
    { d: dot(12, 12, 8.5) },
    { d: 'M3.5 12h17' },
    { d: 'M12 3.5a5 8.5 0 0 1 0 17a5 8.5 0 0 1 0-17' },
  ],

  // The double helix.
  biology: [
    { d: 'M8 3c0 4.5 8 4.5 8 9s-8 4.5-8 9' },
    { d: 'M16 3c0 4.5-8 4.5-8 9s8 4.5 8 9' },
    { d: 'M9.6 6.5h4.8M9.6 17.5h4.8' },
  ],

  // A benzene ring with a core — chemistry turned onto living matter.
  biochemistry: [{ d: 'M12 3.5l7.4 4.25v8.5L12 20.5l-7.4-4.25v-8.5z' }, { d: dot(12, 12, 2.6) }],

  // The helix, read inside brackets.
  bioinformatics: [
    { d: 'M8 4.5H4.5v15H8' },
    { d: 'M16 4.5h3.5v15H16' },
    { d: 'M10 7.5c0 2.5 4 2.5 4 4.5s-4 2-4 4.5' },
    { d: 'M14 7.5c0 2.5-4 2.5-4 4.5s4 2 4 4.5' },
  ],

  // A pulse trace.
  medicine: [{ d: 'M2.5 12.5H7l2.5-6 4 12 2.5-6h5.5' }],

  // A cog: a rim, a hub, and eight short teeth. Long spokes reaching out from a
  // small circle read as a sun at map size, which is why the teeth stop short.
  engineering: [
    { d: dot(12, 12, 6.4) },
    { d: dot(12, 12, 2.4) },
    { d: 'M12 5.6V3.2M12 18.4v2.4M5.6 12H3.2M18.4 12h2.4' },
    { d: 'M12 5.6V3.2M12 18.4v2.4M5.6 12H3.2M18.4 12h2.4', transform: 'rotate(45 12 12)' },
  ],

  /* ──────────────────────────────  Social  ────────────────────────────── */

  // A rising series.
  economics: [
    { d: 'M3.5 20h17' },
    { d: 'M6 16.5l4.5-5.5 3 3 5.5-7.5' },
    { d: 'M15.5 6.5H19V10' },
  ],

  // Scatter with a fitted line through it.
  econometrics: [
    { d: 'M4 4v16h16' },
    { d: 'M6.5 18L20 6' },
    { d: dot(8.5, 14.5, 1.1) },
    { d: dot(12, 13, 1.1) },
    { d: dot(15, 8.5, 1.1) },
    { d: dot(18, 8, 1.1) },
  ],

  // Three figures — a group, not a person.
  sociology: [
    { d: dot(12, 7, 2.6) },
    { d: 'M7.5 20a4.5 4.5 0 0 1 9 0' },
    { d: dot(5, 9.5, 2) },
    { d: 'M2 18a3.4 3.4 0 0 1 3.4-3.4' },
    { d: dot(19, 9.5, 2) },
    { d: 'M22 18a3.4 3.4 0 0 0-3.4-3.4' },
  ],

  // A parliament portico.
  'political-science': [
    { d: 'M3 9.5l9-5.5 9 5.5' },
    { d: 'M6 12v6M10 12v6M14 12v6M18 12v6' },
    { d: 'M3.5 20.5h17' },
  ],

  // Scales.
  law: [
    { d: 'M12 4.5v16' },
    { d: 'M4.5 7.5h15' },
    { d: 'M8 20.5h8' },
    { d: 'M2 13a4 4 0 0 0 8 0l-4-5.5z' },
    { d: 'M14 13a4 4 0 0 0 8 0l-4-5.5z' },
  ],

  // A head with a spiral of thought.
  psychology: [
    { d: 'M17 21v-3h1.5a1 1 0 0 0 .9-1.4L18 13.5A7.5 7.5 0 1 0 7.5 19.5V21' },
    { d: 'M12.5 12.5a1.8 1.8 0 1 0-1.8-1.8c0 2.4 3.6 2.2 3.6-.6a3.4 3.4 0 0 0-3.4-3.1' },
  ],

  // The same head, wired up.
  'cognitive-science': [
    { d: 'M12 3.5a6.5 6.5 0 0 0-4.5 11.2V20h9v-5.3A6.5 6.5 0 0 0 12 3.5z' },
    { d: 'M12 7v4M12 11l-2.5 2M12 11l2.5 2' },
    { d: dot(12, 6, 1.1) },
  ],

  // A carved mask.
  anthropology: [
    { d: 'M12 3.5c-3.8 0-5.8 2.8-5.8 6.6 0 5 2.8 10.4 5.8 10.4s5.8-5.4 5.8-10.4c0-3.8-2-6.6-5.8-6.6z' },
    { d: 'M9 10.5h1.6M13.4 10.5H15' },
    { d: 'M10.5 16h3' },
  ],

  // A pin dropped on a place.
  'human-geography': [
    { d: 'M12 21c0 0 6.8-6.6 6.8-11a6.8 6.8 0 1 0-13.6 0c0 4.4 6.8 11 6.8 11z' },
    { d: dot(12, 10, 2.4) },
  ],

  // An org chart.
  management: [
    { d: 'M9 3h6v4H9z' },
    { d: 'M2.5 17h6v4h-6z' },
    { d: 'M15.5 17h6v4h-6z' },
    { d: 'M12 7v3.5M5.5 13.5V17M18.5 13.5V17M5.5 10.5h13' },
  ],

  // A graduation cap.
  education: [{ d: 'M2 9l10-4.5L22 9l-10 4.5z' }, { d: 'M6.5 11.2v4.3c0 1.7 2.5 3 5.5 3s5.5-1.3 5.5-3v-4.3' }],

  /* ────────────────────────────  Humanities  ──────────────────────────── */

  // A lemniscate: the question that closes on itself.
  philosophy: [{ d: 'M4 12c0-3.2 4.4-3.2 8 0s8 3.2 8 0-4.4-3.2-8 0-8 3.2-8 0z' }],

  // An hourglass.
  history: [
    { d: 'M6 3.5h12M6 20.5h12' },
    { d: 'M7.5 3.5c0 4.8 4.5 6 4.5 8.5s-4.5 3.7-4.5 8.5' },
    { d: 'M16.5 3.5c0 4.8-4.5 6-4.5 8.5s4.5 3.7 4.5 8.5' },
  ],

  // A clock with an orbit round it — knowledge, dated.
  'history-of-science': [
    { d: dot(12, 12, 6.5) },
    { d: 'M12 8v4l3 2' },
    { d: 'M3 12a9 3 0 1 0 18 0a9 3 0 1 0-18 0', transform: 'rotate(-30 12 12)' },
  ],

  // A trowel over the layers it cuts through.
  archaeology: [
    { d: 'M13.5 3l7.5 7.5-3.5 3.5-7.5-7.5z' },
    { d: 'M10 7.5l-7 7V20h5l7-7' },
    { d: 'M2.5 21.5h19' },
  ],

  // A column.
  classics: [
    { d: 'M7 4.5h10' },
    { d: 'M9 4.5v13M15 4.5v13' },
    { d: 'M6.5 17.5h11' },
    { d: 'M5 21h14' },
  ],

  // A flame — the one shape no tradition owns alone.
  religion: [
    { d: 'M12 3c2.8 3.8 5 5.2 5 8.8a5 5 0 0 1-10 0c0-1.9 1-3.1 2-4 .8 1.8 1.9 1.9 2.8.9.7-1.8-.5-3.7-1.8-5.7z' },
  ],

  // Speech, with something said in it.
  linguistics: [{ d: 'M3.5 4.5h17v11.5H9l-5.5 4.5z' }, { d: 'M7.5 8.5h9M7.5 12h5.5' }],

  // The same speech, parsed by a machine.
  'computational-linguistics': [
    { d: 'M3.5 4.5h17v11.5H9l-5.5 4.5z' },
    { d: 'M9.5 8l-2.2 2.2 2.2 2.2' },
    { d: 'M14.5 8l2.2 2.2-2.2 2.2' },
  ],

  // An open book.
  literature: [
    { d: 'M12 6.5C9.4 4.6 6.4 4.3 3.5 5v13c2.9-.7 5.9-.4 8.5 1.5 2.6-1.9 5.6-2.2 8.5-1.5V5c-2.9-.7-5.9-.4-8.5 1.5z' },
    { d: 'M12 6.5v13' },
  ],

  // A framed landscape.
  'art-history': [
    { d: 'M3.5 4h17v16h-17z' },
    { d: 'M6 16l3.5-4 2.5 2.5 2.5-2.5 3.5 4' },
    { d: dot(9, 8.5, 1.5) },
  ],

  // Two beamed notes.
  musicology: [
    { d: 'M9 18.5V6l10-2.5V16' },
    { d: dot(7, 18.5, 2.3) },
    { d: dot(17, 16, 2.3) },
  ],

  // A strip of film.
  'film-studies': [
    { d: 'M3 5h18v14H3z' },
    { d: 'M7.5 5v14M16.5 5v14' },
    { d: 'M3 9.5h4.5M3 14.5h4.5M16.5 9.5H21M16.5 14.5H21' },
  ],

  // Life, under protection.
  bioethics: [
    { d: 'M12 3.2l8 3v6c0 5-4 8.2-8 9.4-4-1.2-8-4.4-8-9.4v-6z' },
    { d: 'M12 9v6M9 12h6' },
  ],
};

/** Anything without a glyph yet still gets a mark rather than a hole. */
const FALLBACK: Glyph[] = [{ d: dot(12, 12, 7) }, { d: dot(12, 12, 2.5) }];

export function glyphFor(domainId: string): Glyph[] {
  return GLYPHS[domainId] ?? FALLBACK;
}

export function hasGlyph(domainId: string): boolean {
  return domainId in GLYPHS;
}

type Props = {
  domainId: string;
  size?: number;
  className?: string;
  strokeWidth?: number;
  style?: React.CSSProperties;
};

/** Standalone icon, for HTML contexts. Takes its colour from `currentColor`. */
export default function DomainIcon({
  domainId,
  size = 18,
  className = '',
  strokeWidth = 1.6,
  style,
}: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
      style={style}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {glyphFor(domainId).map((glyph, index) => (
        <path key={index} d={glyph.d} transform={glyph.transform} />
      ))}
    </svg>
  );
}

/**
 * The same glyph as a bare group, for placing inside the map's own SVG — a
 * nested `<svg>` would not inherit the territory's transform.
 */
export function DomainGlyph({
  domainId,
  x,
  y,
  size,
  colour,
  opacity = 1,
  strokeWidth = 1.6,
}: {
  domainId: string;
  /** Centre of the glyph, in map coordinates. */
  x: number;
  y: number;
  size: number;
  colour: string;
  opacity?: number;
  strokeWidth?: number;
}) {
  const scale = size / 24;
  return (
    <g
      transform={`translate(${x - size / 2} ${y - size / 2}) scale(${scale})`}
      fill="none"
      stroke={colour}
      strokeWidth={strokeWidth / scale}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={opacity}
      aria-hidden="true"
    >
      {glyphFor(domainId).map((glyph, index) => (
        <path key={index} d={glyph.d} transform={glyph.transform} />
      ))}
    </g>
  );
}
