/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        // Shared dark surfaces for the overlay and the popup.
        base: '#121212',
        panel: '#1e1e1e',
        spent: '#3987e5',
        purchase: '#d95926',
        savings: '#199e70',
      },
    },
  },
  plugins: [],
}
