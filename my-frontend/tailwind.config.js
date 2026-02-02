// tailwind.config.cjs
module.exports = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // ✅ Token-driven colors (use like: bg-ui-bg, text-ui-fg, border-ui-border/70)
        'ui-bg': 'rgb(var(--ui-bg) / <alpha-value>)',
        'ui-bg-2': 'rgb(var(--ui-bg-2) / <alpha-value>)',
        'ui-fg': 'rgb(var(--ui-fg) / <alpha-value>)',
        'ui-muted': 'rgb(var(--ui-muted) / <alpha-value>)',

        'ui-card': 'rgb(var(--ui-card) / <alpha-value>)',
        'ui-card-2': 'rgb(var(--ui-card-2) / <alpha-value>)',

        'ui-border': 'rgb(var(--ui-border) / <alpha-value>)',
        'ui-border-2': 'rgb(var(--ui-border-2) / <alpha-value>)',
        'ui-ring': 'rgb(var(--ui-ring) / <alpha-value>)',

        'ui-primary': 'rgb(var(--ui-primary) / <alpha-value>)',
        'ui-primary-2': 'rgb(var(--ui-primary-2) / <alpha-value>)',
        'ui-accent': 'rgb(var(--ui-accent) / <alpha-value>)',

        'ui-success': 'rgb(var(--ui-success) / <alpha-value>)',
        'ui-warning': 'rgb(var(--ui-warning) / <alpha-value>)',
        'ui-danger': 'rgb(var(--ui-danger) / <alpha-value>)',
      },

      // Optional but nice: match your UI rounding system
      borderRadius: {
        'ui-xs': '10px',
        'ui-sm': '12px',
        'ui-md': '16px',
        'ui-lg': '20px',
        'ui-xl': '24px',
      },

      // Optional: shadows you can reuse with class names (shadow-ui / shadow-ui2)
      boxShadow: {
        ui: 'var(--ui-shadow)',
        ui2: 'var(--ui-shadow-2)',
      },
    },
  },
  plugins: [],
}
