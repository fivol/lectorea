type IconProps = {
  name: IconName;
  className?: string;
  size?: number;
};

export type IconName =
  | 'star'
  | 'star-filled'
  | 'check'
  | 'half'
  | 'close'
  | 'search'
  | 'chevron-right'
  | 'chevron-down'
  | 'chevron-left'
  | 'profile'
  | 'external'
  | 'play'
  | 'arrow-left'
  | 'grid'
  | 'map'
  | 'plus'
  | 'minus'
  | 'fit'
  | 'download'
  | 'upload'
  | 'copy'
  | 'sliders'
  | 'sort'
  | 'circle'
  | 'target'
  | 'sun'
  | 'moon'
  | 'warning'
  | 'flame'
  | 'help'
  | 'eye'
  | 'like'
  | 'comment'
  | 'clock'
  | 'hourglass'
  | 'captions'
  | 'list'
  | 'flag';

/** One inline sprite instead of an icon package — twenty glyphs is not a dependency. */
const PATHS: Record<IconName, string> = {
  star: 'M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z',
  'star-filled':
    'M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z',
  check: 'M4.5 12.5l5 5 10-11',
  half: 'M12 4a8 8 0 100 16 8 8 0 000-16zm0 2v12a6 6 0 000-12z',
  close: 'M6 6l12 12M18 6L6 18',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zm5.5 12.5L21 21',
  'chevron-right': 'M9 5l7 7-7 7',
  'chevron-down': 'M5 9l7 7 7-7',
  'chevron-left': 'M15 5l-7 7 7 7',
  profile: 'M12 12a4 4 0 100-8 4 4 0 000 8zm-8 8a8 8 0 0116 0',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5',
  play: 'M8 5l12 7-12 7z',
  'arrow-left': 'M20 12H4m0 0l6-6m-6 6l6 6',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  map: 'M9 4L3 7v13l6-3 6 3 6-3V4l-6 3zM9 4v13M15 7v13',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  download: 'M12 3v12m0 0l-4-4m4 4l4-4M4 19h16',
  upload: 'M12 21V9m0 0L8 13m4-4l4 4M4 5h16',
  // Two sheets, the one behind drawn only where it shows. A full second rect
  // under the first is a grid of four lines at sixteen pixels, not a stack.
  copy: 'M10 8h8a2 2 0 012 2v8a2 2 0 01-2 2h-8a2 2 0 01-2-2v-8a2 2 0 012-2zM16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2',
  sliders: 'M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6',
  sort: 'M7 4v16m0 0l-3-3m3 3l3-3M17 20V4m0 0l-3 3m3-3l3 3',
  circle: 'M12 4a8 8 0 100 16 8 8 0 000-16z',
  /*
   * The week's goal. Not the star — that one is already spoken for by a
   * favourite course, which is a goal of an entirely different kind, and two
   * meanings on one glyph is how a reader learns to stop trusting either.
   *
   * A ring, a centre and four marks aimed at it. The marks are what make it a
   * target rather than a circle inside a circle, which at this size is a full
   * stop with a halo. They stop short of the ring instead of crossing it: a gap
   * survives being drawn at twelve pixels, an intersection turns into a blot.
   */
  target:
    'M12 5.8a6.2 6.2 0 100 12.4 6.2 6.2 0 000-12.4zM12 10.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM12 1v3.4M12 23v-3.4M1 12h3.4M23 12h-3.4',
  sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4',
  moon: 'M21 13a8.5 8.5 0 01-10-10 8.5 8.5 0 1010 10z',
  warning: 'M12 4l9 16H3zM12 10v4m0 3v.5',
  // A run of days. Solid rather than drawn in outline: it is printed at twelve
  // pixels beside a number, and a 1.8px outline at that size is a smudge.
  flame:
    'M12 2.6c.6 2.8 2.3 4 3.5 5.5A6.7 6.7 0 0117 12.2a5 5 0 01-10 0c0-1.9.8-3.3 2-4.5.2 1.2.7 1.9 1.4 2.3.3-2.7.7-5 1.6-7.4z',
  help: 'M12 3a9 9 0 100 18 9 9 0 000-18zM9.6 9.4a2.5 2.5 0 114 2.4c-.9.6-1.6 1-1.6 2.2m0 3v.4',
  /*
   * The eight below are the metadata sheet's vocabulary — see `Facts.tsx`. Each
   * one stands beside a word rather than instead of it: an eye next to
   * «просмотры» is found without reading, and the word is still there for the
   * reader who has not met the glyph before.
   */
  eye: 'M3 12c2.2-3.4 5.2-5.2 9-5.2s6.8 1.8 9 5.2c-2.2 3.4-5.2 5.2-9 5.2S5.2 15.4 3 12zM12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z',
  // The cuff is a separate rectangle rather than part of the outline: joined to
  // the thumb it turns into a single blob at thirteen pixels.
  like: 'M7 20.5V10.5l4.3-7a1.6 1.6 0 012.9 1.3l-1.1 4.6h5.3a2 2 0 011.9 2.6l-1.9 6.4a2.5 2.5 0 01-2.4 1.8H7zM3.5 10.5h3.5v10H3.5z',
  comment: 'M20 16a2 2 0 01-2 2H8.5L4 21.5V6a2 2 0 012-2h12a2 2 0 012 2z',
  clock: 'M12 4.2a7.8 7.8 0 100 15.6 7.8 7.8 0 000-15.6zM12 7.8V12l3 1.8',
  hourglass: 'M7 3.5h10M7 20.5h10M7.5 3.5v3.2L12 12l-4.5 5.3v3.2M16.5 3.5v3.2L12 12l4.5 5.3v3.2',
  // Two open «c»s in a frame, the shape the control has worn on every player
  // since teletext. Drawn as arcs rather than letters so it survives 13px.
  captions:
    'M4.5 6h15a1.5 1.5 0 011.5 1.5v9a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 16.5v-9A1.5 1.5 0 014.5 6zM10.6 10.4a2.3 2.3 0 100 3.2M17.1 10.4a2.3 2.3 0 100 3.2',
  list: 'M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01',
  // A finish flag: how many of the people who started are still there at the end.
  flag: 'M5.5 21V4m0 .5h11.2l-1.9 3.6 1.9 3.6H5.5',
};

const FILLED: IconName[] = ['star-filled', 'play', 'half', 'grid', 'flame'];

export default function Icon({ name, className = '', size = 16 }: IconProps) {
  const filled = FILLED.includes(name);
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={`shrink-0 ${className}`}
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
