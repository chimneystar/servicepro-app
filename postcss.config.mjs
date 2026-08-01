// Tailwind was removed in ledger 6.5 — it contributed only its Preflight reset,
// which is now inlined verbatim at the top of app/globals.css. Autoprefixer
// stays: this stylesheet still hand-writes rules that need -webkit- prefixes.
const config = {
  plugins: { autoprefixer: {} },
};

export default config;
