import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{html,js,svelte,ts}"],
  theme: {
    extend: {
      colors: {
        surface: {
          950: "#030712",
          900: "#0f1117",
          800: "#1a1d27",
          700: "#252836",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
