import nextConfig from "eslint-config-next";

const config = [
  ...nextConfig,
  {
    ignores: ["node_modules/**", ".next/**", "public/**"],
  },
];

export default config;
