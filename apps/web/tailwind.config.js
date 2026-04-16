
/** @type {import('tailwindcss').Config} */
//
// Tailwind v4 NOTE:
// Colors are NOT configured here. In v4, theme.extend.colors is ignored.
// All color tokens live in globals.css inside @theme inline {}.
// This file exists only for IDE autocomplete and content path scanning.
//
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
