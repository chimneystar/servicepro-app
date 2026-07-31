import nextConfig from "eslint-config-next";

const config = [
  ...nextConfig,
  {
    // `.claude/**` holds agent worktrees — full checkouts with their own
    // node_modules and .next output. Linting them scans megabytes of build
    // chunks and reports warnings about code that is not ours.
    ignores: ["node_modules/**", ".next/**", "public/**", ".claude/**", "test-results/**", "playwright-report/**"],
  },
];

export default config;
