import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: "#0f2a5e",
        brand: { DEFAULT: "#2563eb", dark: "#1d4ed8", light: "#dbeafe" },
        sky2: "#38bdf8",
      },
    },
  },
  plugins: [],
};
export default config;
