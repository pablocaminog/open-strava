/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        accent: '#C8FA1F', // pace volt — primary accent
        ink: {
          0: 'var(--ink-0)',
          25: 'var(--ink-25)',
          50: 'var(--ink-50)',
          100: 'var(--ink-100)',
          200: 'var(--ink-200)',
          300: 'var(--ink-300)',
          400: 'var(--ink-400)',
          500: 'var(--ink-500)',
          600: 'var(--ink-600)',
          700: 'var(--ink-700)',
          800: 'var(--ink-800)',
          900: 'var(--ink-900)',
          950: 'var(--ink-950)',
        },
      },
      fontFamily: {
        sans: ['Geist', 'ui-sans-serif', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', '"JetBrains Mono"', 'Menlo', 'Consolas', 'monospace'],
        serif: ['Fraunces', 'ui-serif', 'Georgia', 'serif'],
      },
    },
  },
};
