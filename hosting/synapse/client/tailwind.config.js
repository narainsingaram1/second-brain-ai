/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        canvas: {
          light: "#edf0f5",
          dark: "#0b0d13",
        },
        card: {
          light: "#ffffff",
          dark: "#141721",
        },
        inset: {
          light: "#f5f7fb",
          dark: "#1c202c",
        },
        pill: {
          black: "#0d0f14",
          border: "#e2e6ee",
        },
      },
      fontFamily: {
        sans: ["'Plus Jakarta Sans'", "Inter", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
      },
      boxShadow: {
        tactile: "0 4px 20px -2px rgba(18, 26, 45, 0.06), 0 1px 3px 0 rgba(18, 26, 45, 0.03)",
        card: "0 10px 30px -5px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.02)",
        floating: "0 20px 50px -12px rgba(15, 23, 42, 0.12), 0 4px 10px -2px rgba(15, 23, 42, 0.04)",
        innerPill: "inset 0 1px 2px rgba(0,0,0,0.04)",
      },
      borderRadius: {
        "3xl": "1.75rem",
        "4xl": "2.25rem",
        "5xl": "3rem",
      },
    },
  },
  plugins: [],
}
