// tailwind.config.cjs
module.exports = {
  darkMode: 'class', // 👈 important
  content: [
    './index.html',
    './src/**/*.{vue,js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
