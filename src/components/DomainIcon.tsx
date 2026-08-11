/**
 * One line-art glyph per domain, on a 24×24 grid.
 *
 * Inline rather than one SVG file per domain: the map screen shows all 39 at
 * once, so files would mean 39 requests for ~200 bytes each, and `currentColor`
 * would be lost — the glyph has to take the domain's colour and the theme's
 * contrast, which a linked image cannot do.
 *
 * Everything is stroked, nothing is filled, so the whole set stays legible at
 * 14 px next to a heading and at 40 px in the middle of a territory. Keep any
 * two parallel lines at least 2 grid units apart — the map draws these at
 * stroke 2–2.6, and anything tighter fuses into a blot.
 */

/** A circle as path data, since these glyphs are a flat list of `d` strings. */
function dot(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;
}

type Glyph = { d: string; transform?: string };

const GLYPHS: Record<string, Glyph[]> = {
  /* ────────────────────────  Formal and natural  ──────────────────────── */

  // Summation sign — the one symbol every field below borrows from.
  math: [{ d: 'M17 4.5H7l6.5 7.5L7 19.5h10' }],

  // Turnstile growing an arrowhead: premises on the left, conclusion follows.
  logic: [{ d: 'M5.5 5v14' }, { d: 'M5.5 12h12' }, { d: 'M14 8.5l3.5 3.5-3.5 3.5' }],

  // A normal distribution resting on its axis.
  probability: [{ d: 'M3 19h18' }, { d: 'M3.5 19c4.6 0 3.4-11.5 8.5-11.5s3.9 11.5 8.5 11.5' }],

  // Angle brackets and a slash.
  cs: [{ d: 'M9 8l-4.2 4L9 16' }, { d: 'M15 8l4.2 4L15 16' }, { d: 'M13.4 5.5l-2.8 13' }],

  // A three-layer network. Links stop short of the nodes so the joints breathe.
  'machine-learning': [
    { d: 'M7.1 8.5l2.8 2M7.1 15.5l2.8-2M14.1 10.5l2.8-2M14.1 13.5l2.8 2' },
    { d: dot(5, 7, 1.8) },
    { d: dot(5, 17, 1.8) },
    { d: dot(12, 12, 1.8) },
    { d: dot(19, 7, 1.8) },
    { d: dot(19, 17, 1.8) },
  ],

  // Atom: three orbits and a nucleus.
  physics: [
    { d: 'M12 4.2a3.2 7.8 0 0 1 0 15.6a3.2 7.8 0 0 1 0-15.6' },
    { d: 'M12 4.2a3.2 7.8 0 0 1 0 15.6a3.2 7.8 0 0 1 0-15.6', transform: 'rotate(60 12 12)' },
    { d: 'M12 4.2a3.2 7.8 0 0 1 0 15.6a3.2 7.8 0 0 1 0-15.6', transform: 'rotate(120 12 12)' },
    { d: dot(12, 12, 1.4) },
  ],

  // A ringed planet. The ring breaks off at the disc instead of crossing it,
  // so the planet reads as a solid body, not a Venn diagram.
  astronomy: [
    { d: dot(12, 12, 4.6) },
    { d: 'M15.51 7.64A10 3.3 -20 0 1 17.49 13.09' },
    { d: 'M8.49 16.36A10 3.3 -20 0 1 6.51 10.91' },
  ],

  // Erlenmeyer flask with its liquid line.
  chemistry: [
    { d: 'M9.6 3.5h4.8' },
    { d: 'M10.4 3.5v5.6L5.5 17.7a2.2 2.2 0 0 0 2 3.1h9a2.2 2.2 0 0 0 2-3.1L13.6 9.1V3.5' },
    { d: 'M7.3 14.5h9.4' },
  ],

  // Two orbitals crossing over a nucleus. Slim lobes: at map stroke widths a
  // rounder pair fuses into a clover.
  'quantum-chemistry': [
    { d: 'M12 5.2a2.6 6.8 0 0 1 0 13.6a2.6 6.8 0 0 1 0-13.6', transform: 'rotate(45 12 12)' },
    { d: 'M12 5.2a2.6 6.8 0 0 1 0 13.6a2.6 6.8 0 0 1 0-13.6', transform: 'rotate(-45 12 12)' },
  ],

  // Globe with an equator and a meridian.
  'earth-science': [
    { d: dot(12, 12, 8.5) },
    { d: 'M3.5 12h17' },
    { d: 'M12 3.5a4.6 8.5 0 0 1 0 17a4.6 8.5 0 0 1 0-17' },
  ],

  // The double helix.
  biology: [
    { d: 'M8.5 3.5c0 4.7 7 4.3 7 8.5s-7 3.8-7 8.5' },
    { d: 'M15.5 3.5c0 4.7-7 4.3-7 8.5s7 3.8 7 8.5' },
    { d: 'M9.8 6.4h4.4M9.8 17.6h4.4' },
  ],

  // A benzene ring with a core — chemistry turned onto living matter.
  biochemistry: [{ d: 'M12 3.5l7.4 4.25v8.5L12 20.5l-7.4-4.25v-8.5z' }, { d: dot(12, 12, 2.8) }],

  // The helix, read inside brackets.
  bioinformatics: [
    { d: 'M8 4.5H4.5v15H8' },
    { d: 'M16 4.5h3.5v15H16' },
    { d: 'M9.8 7.5c0 2.6 4.4 2.4 4.4 4.5s-4.4 1.9-4.4 4.5' },
    { d: 'M14.2 7.5c0 2.6-4.4 2.4-4.4 4.5s4.4 1.9 4.4 4.5' },
  ],

  // A pulse trace.
  medicine: [{ d: 'M3 12.5h3.8l2.4-5.5 3.8 11 2.4-5.5H21' }],

  // A gear, drawn as one toothed outline around a hub. Generated: 8 teeth,
  // tip radius 9.6, root radius 7.1, flanks 7.5°→15.5° off each tooth centre.
  engineering: [
    {
      d: 'M10.1 5.16L10.75 2.48A9.6 9.6 0 0 1 13.25 2.48L13.9 5.16A7.1 7.1 0 0 1 15.5 5.82L17.84 4.38A9.6 9.6 0 0 1 19.62 6.16L18.18 8.5A7.1 7.1 0 0 1 18.84 10.1L21.52 10.75A9.6 9.6 0 0 1 21.52 13.25L18.84 13.9A7.1 7.1 0 0 1 18.18 15.5L19.62 17.84A9.6 9.6 0 0 1 17.84 19.62L15.5 18.18A7.1 7.1 0 0 1 13.9 18.84L13.25 21.52A9.6 9.6 0 0 1 10.75 21.52L10.1 18.84A7.1 7.1 0 0 1 8.5 18.18L6.16 19.62A9.6 9.6 0 0 1 4.38 17.84L5.82 15.5A7.1 7.1 0 0 1 5.16 13.9L2.48 13.25A9.6 9.6 0 0 1 2.48 10.75L5.16 10.1A7.1 7.1 0 0 1 5.82 8.5L4.38 6.16A9.6 9.6 0 0 1 6.16 4.38L8.5 5.82A7.1 7.1 0 0 1 10.1 5.16Z',
    },
    { d: dot(12, 12, 2.9) },
  ],

  /* ──────────────────────────────  Social  ────────────────────────────── */

  // A rising series with an arrowhead.
  economics: [
    { d: 'M3.5 20.5h17' },
    { d: 'M5.5 16.5l4.5-5.5 3 3 5.5-7' },
    { d: 'M15 7h3.5v3.5' },
  ],

  // Scatter with a fitted line through it — every point clearly off the line.
  econometrics: [
    { d: 'M4 4v16h16' },
    { d: 'M6.5 18L20 6' },
    { d: dot(9, 14, 1.15) },
    { d: dot(11.5, 15.5, 1.15) },
    { d: dot(14, 9.5, 1.15) },
    { d: dot(17, 11, 1.15) },
  ],

  // Three figures — a group, not a person.
  sociology: [
    { d: dot(12, 6.8, 2.7) },
    { d: 'M7.4 20a4.6 4.6 0 0 1 9.2 0' },
    { d: dot(4.9, 9.7, 2.1) },
    { d: 'M1.8 18.2a3.5 3.5 0 0 1 3.5-3.5' },
    { d: dot(19.1, 9.7, 2.1) },
    { d: 'M22.2 18.2a3.5 3.5 0 0 0-3.5-3.5' },
  ],

  // A parliament portico.
  'political-science': [
    { d: 'M3 9.5l9-5.5 9 5.5' },
    { d: 'M6.3 12v6M10.1 12v6M13.9 12v6M17.7 12v6' },
    { d: 'M3.5 20.5h17' },
  ],

  // Scales.
  law: [
    { d: 'M12 4.5v16' },
    { d: 'M4.5 7h15' },
    { d: 'M8.5 20.5h7' },
    { d: 'M2.2 12.6a3.9 3.9 0 0 0 7.8 0L6.1 7z' },
    { d: 'M14 12.6a3.9 3.9 0 0 0 7.8 0L17.9 7z' },
  ],

  // Psi — the discipline's own letter, and no longer a twin of the
  // cognitive-science head.
  psychology: [{ d: 'M5.5 4.5v3.8a6.5 6.5 0 0 0 13 0V4.5' }, { d: 'M12 4.5V20' }],

  // A head in profile, wired up.
  'cognitive-science': [
    { d: 'M17 21v-3h1.5a1 1 0 0 0 .9-1.4L18 13.5A7.5 7.5 0 1 0 7.5 19.5V21' },
    { d: 'M10.6 10v2.4M10.6 12.4l-2.3 1.9M10.6 12.4l2.3 1.9' },
    { d: dot(10.6, 8.6, 1) },
  ],

  // A carved mask.
  anthropology: [
    { d: 'M12 3.5c-3.6 0-5.6 2.6-5.6 6.3 0 4.9 2.7 10.7 5.6 10.7s5.6-5.8 5.6-10.7c0-3.7-2-6.3-5.6-6.3z' },
    { d: 'M8.7 10.5h2.1M13.2 10.5h2.1' },
    { d: 'M10.4 15.5h3.2' },
  ],

  // A pin dropped on a place.
  'human-geography': [
    { d: 'M12 21.5c0 0 7-6.9 7-11.4a7 7 0 1 0-14 0c0 4.5 7 11.4 7 11.4z' },
    { d: dot(12, 9.8, 2.5) },
  ],

  // An org chart.
  management: [
    { d: 'M8.8 3h6.4v4.4H8.8z' },
    { d: 'M2.5 16.6h6.4V21H2.5z' },
    { d: 'M15.1 16.6h6.4V21h-6.4z' },
    { d: 'M12 7.4v4.9' },
    { d: 'M5.7 16.6v-4.3h12.6v4.3' },
  ],

  // A graduation cap, tassel included.
  education: [
    { d: 'M2 9l10-4.5L22 9l-10 4.5z' },
    { d: 'M6.5 11v4.4c0 1.7 2.5 3.1 5.5 3.1s5.5-1.4 5.5-3.1V11' },
    { d: 'M22 9v4.5' },
  ],

  /* ────────────────────────────  Humanities  ──────────────────────────── */

  // A lemniscate: the question that closes on itself.
  philosophy: [{ d: 'M12 12C9.3 8.2 4 8.2 4 12s5.3 3.8 8 0 8-3.8 8 0-5.3 3.8-8 0' }],

  // An hourglass.
  history: [
    { d: 'M6.5 3.5h11M6.5 20.5h11' },
    { d: 'M8 3.5c0 4.6 4 5.7 4 8.5s-4 3.9-4 8.5' },
    { d: 'M16 3.5c0 4.6-4 5.7-4 8.5s4 3.9 4 8.5' },
  ],

  // A clock with an orbit round it — knowledge, dated. The orbit breaks off
  // at the dial so the hands stay readable.
  'history-of-science': [
    { d: dot(12, 12, 6.3) },
    { d: 'M12 8.5V12l2.6 1.8' },
    { d: 'M16.97 7.07A9.8 3.2 -25 0 1 18.97 11.37' },
    { d: 'M7.03 16.93A9.8 3.2 -25 0 1 5.03 12.63' },
  ],

  // A trowel over the layers it cuts through.
  archaeology: [
    { d: 'M13.5 3l7.5 7.5-3.5 3.5-7.5-7.5z' },
    { d: 'M10 7.5l-7 7V20h5l7-7' },
    { d: 'M2.5 21.5h19' },
  ],

  // A column.
  classics: [
    { d: 'M6.5 4.5h11' },
    { d: 'M9 4.5v13M15 4.5v13' },
    { d: 'M6.5 17.5h11' },
    { d: 'M5 21h14' },
  ],

  // A flame — the one shape no tradition owns alone.
  religion: [
    { d: 'M12 3c2.8 3.8 5 5.2 5 8.8a5 5 0 0 1-10 0c0-1.9 1-3.1 2-4 .8 1.8 1.9 1.9 2.8.9.7-1.8-.5-3.7-1.8-5.7z' },
  ],

  // Speech, with something said in it.
  linguistics: [
    { d: 'M21 14.5a2 2 0 0 1-2 2H8l-4.5 4V6a2 2 0 0 1 2-2H19a2 2 0 0 1 2 2z' },
    { d: 'M8 8.5h8M8 12h5.5' },
  ],

  // The same speech, parsed by a machine.
  'computational-linguistics': [
    { d: 'M21 14.5a2 2 0 0 1-2 2H8l-4.5 4V6a2 2 0 0 1 2-2H19a2 2 0 0 1 2 2z' },
    { d: 'M10 8.2l-2.2 2.1 2.2 2.1' },
    { d: 'M14 8.2l2.2 2.1-2.2 2.1' },
  ],

  // An open book.
  literature: [
    { d: 'M12 6.5C9.4 4.6 6.4 4.3 3.5 5v13c2.9-.7 5.9-.4 8.5 1.5 2.6-1.9 5.6-2.2 8.5-1.5V5c-2.9-.7-5.9-.4-8.5 1.5z' },
    { d: 'M12 6.5v13' },
  ],

  // A framed landscape.
  'art-history': [
    { d: 'M3.5 4.5h17v15h-17z' },
    { d: 'M6 17.5l3.6-4.3 2.5 3 2.3-2.7 3.6 4' },
    { d: dot(15.7, 8.5, 1.6) },
  ],

  // Two beamed notes.
  musicology: [
    { d: 'M9.2 18.2V6l10-2.5v12.2' },
    { d: dot(6.9, 18.2, 2.3) },
    { d: dot(16.9, 15.7, 2.3) },
  ],

  // A strip of film.
  'film-studies': [
    { d: 'M3 5.5h18v13H3z' },
    { d: 'M7.5 5.5v13M16.5 5.5v13' },
    { d: 'M3 10h4.5M3 14h4.5M16.5 10H21M16.5 14H21' },
  ],

  // Life, under protection.
  bioethics: [
    { d: 'M12 3.2l8 3.1v5.8c0 5-4 8.2-8 9.4-4-1.2-8-4.4-8-9.4V6.3z' },
    { d: 'M12 8.6v6.2M8.9 11.7h6.2' },
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
      // In `style`, not as an attribute: the map passes a `var(--…)` here so the
      // glyph follows the theme, and a presentation attribute is the one place
      // that is not guaranteed to resolve.
      style={{ stroke: colour }}
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
