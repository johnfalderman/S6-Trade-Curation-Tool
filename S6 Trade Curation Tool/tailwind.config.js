/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        s6: {
          dark: '#1a1a1a',
          accent: '#e84855',
          light: '#f5f5f0',
        },
      },
    },
  },
  plugins: [],
};
