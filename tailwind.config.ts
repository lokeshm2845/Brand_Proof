import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        nova: { DEFAULT: "#3B2FC9", dark: "#2A2196", soft: "#EFEDFF" },
        ink: "#14172B",
        amber: { brand: "#F5A524" },
      },
    },
  },
  plugins: [],
};
export default config;
