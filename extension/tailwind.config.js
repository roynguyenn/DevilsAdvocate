/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        spent: '#3987e5',
        purchase: '#d95926',
        savings: '#199e70',
      },
    },
  },
  plugins: [],
}
