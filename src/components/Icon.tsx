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
  | 'sliders'
  | 'sort'
  | 'circle'
  | 'sun'
  | 'moon'
  | 'warning';

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
  sliders: 'M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6',
  sort: 'M7 4v16m0 0l-3-3m3 3l3-3M17 20V4m0 0l-3 3m3-3l3 3',
  circle: 'M12 4a8 8 0 100 16 8 8 0 000-16z',
  sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4',
  moon: 'M21 13a8.5 8.5 0 01-10-10 8.5 8.5 0 1010 10z',
  warning: 'M12 4l9 16H3zM12 10v4m0 3v.5',
};

const FILLED: IconName[] = ['star-filled', 'play', 'half', 'grid'];

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
