/**
 * A theme colour that survives an opacity modifier.
 *
 * Every colour in the palette is a bare `var(--c-…)`, which Tailwind cannot
 * parse — so `bg-accent/60` compiled to **nothing at all**: not a weaker green,
 * no declaration whatsoever, and no warning. Ten places in the product were
 * painting invisible progress fills and scrims that way, and the floating
 * search field grew a hand-written `.glass` class to get around it.
 *
 * Given a function, Tailwind asks the colour for its own value and hands over
 * the alpha, so the mix can be written out with `color-mix` — the same device
 * `.glass` used, done once for every colour instead of per class. Without a
 * modifier Tailwind passes its own `--tw-*-opacity` variable, which is always
 * `1` here: that case hands back the plain `var()`, so every rule already
 * generated stays byte for byte what it was.
 */
const themed =
  (name) =>
  ({ opacityValue } = {}) => {
    if (opacityValue === undefined || String(opacityValue).startsWith('var(')) {
      return `var(${name})`;
    }
    const alpha = String(opacityValue).endsWith('%')
      ? String(opacityValue)
      : `${Number(opacityValue) * 100}%`;
    if (alpha.includes('NaN')) return `var(${name})`;
    return `color-mix(in srgb, var(${name}) ${alpha}, transparent)`;
  };

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Every colour is a CSS variable so themes swap without a rebuild — and
        // so the map screen can repaint the whole palette for one route by
        // overriding the variables rather than the classes. Through `themed`,
        // so that `/40` on any of them means what it says — see above.
        canvas: themed('--c-canvas'),
        surface: themed('--c-surface'),
        'surface-2': themed('--c-surface-2'),
        overlay: themed('--c-overlay'),
        line: themed('--c-line'),
        'line-strong': themed('--c-line-strong'),
        ink: themed('--c-ink'),
        'ink-dim': themed('--c-ink-dim'),
        'ink-faint': themed('--c-ink-faint'),
        formal: themed('--c-formal'),
        'formal-soft': themed('--c-formal-soft'),
        social: themed('--c-social'),
        'social-soft': themed('--c-social-soft'),
        humanities: themed('--c-humanities'),
        'humanities-soft': themed('--c-humanities-soft'),
        accent: themed('--c-accent'),
        'accent-soft': themed('--c-accent-soft'),
        warning: themed('--c-warning'),
        danger: themed('--c-danger'),
      },
      // Named by what they are put on, not by size: `rounded-card` cannot drift
      // from the card the way `rounded-xl` can.
      borderRadius: {
        chip: 'var(--radius-sm)',
        card: 'var(--radius-md)',
        pop: 'var(--radius-lg)',
      },
      fontFamily: {
        display: ['Unbounded', 'system-ui', 'sans-serif'],
        sans: ['Onest', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      // The type scale. Weight travels with the size because these are roles —
      // a heading that is 28px but not bold is not this heading.
      fontSize: {
        h1: ['28px', { lineHeight: '34px', fontWeight: '700' }],
        h2: ['22px', { lineHeight: '28px', fontWeight: '700' }],
        h3: ['16px', { lineHeight: '22px', fontWeight: '600' }],
        body: ['14px', { lineHeight: '21px', fontWeight: '400' }],
        caption: ['13px', { lineHeight: '18px', fontWeight: '400' }],
        mono: ['13px', { lineHeight: '18px', fontWeight: '500' }],
        'mono-label': [
          '12px',
          { lineHeight: '16px', letterSpacing: '0.06em', fontWeight: '600' },
        ],
      },
      // Both scales point at the variables, so `prefers-reduced-motion` can
      // switch the whole product off by redefining three of them.
      transitionDuration: {
        fast: 'var(--dur-fast)',
        base: 'var(--dur-base)',
        slow: 'var(--dur-slow)',
      },
      transitionTimingFunction: {
        out: 'var(--ease-out)',
        in: 'var(--ease-in)',
        inout: 'var(--ease-inout)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-in-right': {
          from: { transform: 'translateX(24px)', opacity: '0' },
          to: { transform: 'translateX(0)', opacity: '1' },
        },
        'slide-in-bottom': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.97)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        // Popovers grow out of the edge they are anchored to rather than
        // appearing whole, which is what makes them read as attached.
        'pop-in': {
          from: { opacity: '0', transform: 'scaleY(0.96)' },
          to: { opacity: '1', transform: 'scaleY(1)' },
        },
      },
      animation: {
        'fade-in': 'fade-in var(--dur-base) var(--ease-out)',
        'slide-in-right': 'slide-in-right var(--dur-base) var(--ease-out)',
        'slide-in-bottom': 'slide-in-bottom var(--dur-base) var(--ease-out)',
        'scale-in': 'scale-in var(--dur-slow) var(--ease-out)',
        'pop-in': 'pop-in var(--dur-fast) var(--ease-out)',
      },
    },
  },
  plugins: [],
};
