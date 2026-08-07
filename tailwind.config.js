/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Every colour is a CSS variable so themes swap without a rebuild — and
        // so the map screen can repaint the whole palette for one route by
        // overriding the variables rather than the classes.
        canvas: 'var(--c-canvas)',
        surface: 'var(--c-surface)',
        'surface-2': 'var(--c-surface-2)',
        overlay: 'var(--c-overlay)',
        line: 'var(--c-line)',
        'line-strong': 'var(--c-line-strong)',
        ink: 'var(--c-ink)',
        'ink-dim': 'var(--c-ink-dim)',
        'ink-faint': 'var(--c-ink-faint)',
        formal: 'var(--c-formal)',
        'formal-soft': 'var(--c-formal-soft)',
        social: 'var(--c-social)',
        'social-soft': 'var(--c-social-soft)',
        humanities: 'var(--c-humanities)',
        'humanities-soft': 'var(--c-humanities-soft)',
        accent: 'var(--c-accent)',
        'accent-soft': 'var(--c-accent-soft)',
        warning: 'var(--c-warning)',
        danger: 'var(--c-danger)',
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
