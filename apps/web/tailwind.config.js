/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: "#13233A",
        terra: "#B9472E",
        ochre: "#D9A441",
        sea: "#1E8FA3",
        olive: "#5F8A3A",
        cream: "#FBF5E6",
        lime: "#F1E8D4",
        ink: "#13233A",
        "ink-2": "#4A5A6E",
        "ink-3": "#7A8696",
        grout: "#E2D6BD",
      },
      fontFamily: {
        display: ['"Pixelify Sans"', "monospace"],
        tag: ["Silkscreen", "monospace"],
        sans: ['"Space Grotesk Variable"', '"Space Grotesk"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono Variable"', '"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      borderRadius: { none: "0", DEFAULT: "0" },
    },
  },
  plugins: [],
};
