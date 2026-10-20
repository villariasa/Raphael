/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        raphael: {
          bg: '#0f1115',
          surface: '#171a21',
          surfaceAlt: '#1f232c',
          border: '#2a2f3a',
          accent: '#4f7cff',
          accentMuted: '#2f4280',
          text: '#e6e8ec',
          textMuted: '#9aa3b2',
          danger: '#e5484d',
          warn: '#e8a33d',
          ok: '#3ecf8e'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
};
