import nextConfig from "eslint-config-next";

const config = [
  ...nextConfig,
  {
    // ACCESSIBILITY (ledger 6.6). These are ERRORS, not warnings, and none of
    // them is disabled anywhere in the tree — a rule switched off at every call
    // site is not a rule. If one fires, the fix is the markup.
    //
    // The set is deliberately the subset the audit found real defects for:
    // unlabelled controls (`htmlFor` appeared ZERO times in the whole codebase),
    // click handlers on non-interactive elements, controls with no accessible
    // name, and invalid ARIA. The rest of the plugin's recommended set is not
    // turned on here because it would land as a wall of pre-existing noise
    // across files this pass does not own; that is 6.6's remaining work and it
    // is recorded as such in docs/REMEDIATION-PLAN.md rather than hidden.
    // The plugin itself is already registered by `eslint-config-next`; only the
    // rules are set here (re-registering it is a hard config error).
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    rules: {
      "jsx-a11y/label-has-associated-control": ["error", { assert: "either", depth: 6 }],
      "jsx-a11y/click-events-have-key-events": "error",
      // `handlers` is the plugin's own documented default set — click and key
      // events. It is stated explicitly because eslint-config-next widens it to
      // include drag events, and a drag target is a different problem: no ARIA
      // attribute makes dragging keyboard-operable, only a second control does.
      // The one place that mattered, the dispatch board, now has that control
      // (a per-job "assign to" select driving the same action), so the gap is
      // closed in the markup rather than waved through by the linter.
      "jsx-a11y/no-static-element-interactions": ["error", { handlers: ["onClick", "onMouseDown", "onMouseUp", "onKeyPress", "onKeyDown", "onKeyUp"] }],
      "jsx-a11y/no-noninteractive-element-interactions": ["error", { handlers: ["onClick", "onMouseDown", "onMouseUp", "onKeyPress", "onKeyDown", "onKeyUp"] }],
      "jsx-a11y/anchor-has-content": "error",
      "jsx-a11y/aria-props": "error",
      "jsx-a11y/aria-proptypes": "error",
      "jsx-a11y/aria-role": "error",
      "jsx-a11y/aria-unsupported-elements": "error",
      "jsx-a11y/role-has-required-aria-props": "error",
      "jsx-a11y/role-supports-aria-props": "error",
      "jsx-a11y/heading-has-content": "error",
      "jsx-a11y/iframe-has-title": "error",
      "jsx-a11y/no-redundant-roles": "error",
      "jsx-a11y/tabindex-no-positive": "error",
    },
  },
  {
    // `.claude/**` holds agent worktrees — full checkouts with their own
    // node_modules and .next output. Linting them scans megabytes of build
    // chunks and reports warnings about code that is not ours.
    ignores: ["node_modules/**", ".next/**", "public/**", ".claude/**", "test-results/**", "playwright-report/**"],
  },
];

export default config;
