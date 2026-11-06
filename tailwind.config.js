/** @type {import('tailwindcss').Config} */

// Graphite: the neutral ramp every surface, border and text color comes from.
const graphite = {
  50: "#fafafa", 100: "#f4f4f5", 200: "#e7e7e9", 300: "#d4d4d8", 400: "#a1a1a6",
  500: "#737378", 600: "#525257", 700: "#3f3f44", 800: "#27272a", 900: "#19191b", 950: "#111112",
};
// Fountain-pen ink: the single accent. 600 is the accent on light, 400 on dark.
const ink = {
  50: "#eef2fd", 100: "#dde5fb", 200: "#bccbf6", 300: "#8fa8ef", 400: "#6f8ff0",
  500: "#3a62dc", 600: "#2f55d4", 700: "#2846b0", 800: "#233c8e", 900: "#1f346f", 950: "#152147",
};

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Every cool grey family resolves to graphite, and every violet family to the one ink accent,
        // so legacy class names across the app land on the same palette.
        slate: graphite, gray: graphite, zinc: graphite, neutral: graphite,
        violet: ink, purple: ink, indigo: ink, fuchsia: ink, blue: ink, sky: ink, cyan: ink,
        panel: "var(--workspace-panel)",
        raised: "var(--workspace-raised)",
        line: "var(--workspace-line)",
        ink: "var(--workspace-ink)",
        secondary: "var(--workspace-secondary)",
        muted: "var(--workspace-muted)",
        accent: "var(--workspace-accent)",
        tint: "var(--workspace-tint)",
        primary: "#2f55d4",
        canvas: { light: "#fafafa", dark: "#141415" },
        card: { light: "#ffffff", dark: "#19191b" },
        inset: { light: "#f4f4f5", dark: "#232325" },
        pill: { black: "#171717", border: "#e7e7e9" },
      },
      fontFamily: {
        sans: ["Geist", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        mono: ["'Geist Mono'", "ui-monospace", "SFMono-Regular", "monospace"],
        serif: ["Newsreader", "Georgia", "serif"],
      },
      // Two weights carry the hierarchy; 600 is the rare emphasis.
      fontWeight: { light: "400", normal: "400", medium: "500", semibold: "500", bold: "500", extrabold: "600", black: "600" },
      letterSpacing: { tighter: "-0.02em", tight: "-0.01em", wide: "0", wider: "0.01em", widest: "0.01em" },
      boxShadow: {
        "2xs": "0 1px 2px rgba(0,0,0,0.04)",
        xs: "0 1px 2px rgba(0,0,0,0.04)",
        sm: "0 1px 2px rgba(0,0,0,0.05)",
        DEFAULT: "0 1px 2px rgba(0,0,0,0.05)",
        md: "0 2px 8px rgba(0,0,0,0.05)",
        lg: "0 8px 24px rgba(0,0,0,0.06)",
        xl: "0 12px 32px rgba(0,0,0,0.08)",
        "2xl": "0 16px 48px rgba(0,0,0,0.10)",
        tactile: "0 1px 2px rgba(0,0,0,0.05)",
        card: "0 1px 2px rgba(0,0,0,0.04)",
        floating: "0 8px 24px rgba(0,0,0,0.06)",
        innerPill: "none",
      },
      borderRadius: { "2xl": "0.75rem", "3xl": "0.875rem", "4xl": "1rem", "5xl": "1.125rem" },
      transitionProperty: { all: "color, background-color, border-color, opacity, transform, box-shadow" },
      transitionTimingFunction: { DEFAULT: "cubic-bezier(0.22, 1, 0.36, 1)" },
      transitionDuration: { DEFAULT: "150ms" },
    },
  },
  plugins: [],
};
